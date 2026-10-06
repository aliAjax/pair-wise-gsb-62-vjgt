import { Injectable, inject } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { Store } from '@ngrx/store'
import { EMPTY, catchError, concatMap, delay, filter, first, map, of } from 'rxjs'
import { TailingsApiService } from '../services/tailings-api.service'
import { batchHasPendingEvidence, type OfflineEvidence, type TailingsDataset } from '../domain'
import { TailingsActions } from './tailings.actions'

interface TailingsRoot {
  tailings: { dataset: TailingsDataset; online: boolean }
}

@Injectable()
export class TailingsEffects {
  private readonly actions$ = inject(Actions)
  private readonly api = inject(TailingsApiService)
  private readonly store = inject(Store<TailingsRoot>)

  loadDataset$ = createEffect(() => this.actions$.pipe(
    ofType(TailingsActions.loadDataset),
    concatMap(() => this.api.loadDataset().pipe(
      map((dataset) => TailingsActions.loadDatasetSuccess({ dataset })),
      catchError((error: Error) => of(TailingsActions.loadDatasetFailure({ error: error.message })))
    ))
  ))

  /** 网络恢复后自动恢复所有未完成批次，继续上传现场证据。 */
  resumeOnReconnect$ = createEffect(() => this.actions$.pipe(
    ofType(TailingsActions.setOnline),
    filter(({ online }) => online),
    map(() => TailingsActions.resumePendingBatches())
  ))

  /**
   * 证据上传队列（单一驱动源，重放不重复上传、不多审计）：
   * - submit：批次进入上传阶段，取第一项待上传证据；
   * - retry/每轮结束：成功则推进下一项，失败退避后重试同一项；
   * - 已上传证据在 reducer 内幂等跳过；刷新页面后由 resumePendingBatches 重新驱动。
   * 每次只取一份当前状态（first），避免状态热流重复发起上传。
   * 队列清空后派发 finishBatchReconcile，由纯函数引擎提交对账（只提交一次）。
   */
  uploadQueue$ = createEffect(() => this.actions$.pipe(
    ofType(
      TailingsActions.submitBatchWhenOnline,
      TailingsActions.retryFailedEvidence,
      TailingsActions.resumePendingBatches
    ),
    concatMap((action) => {
      if ('online' in action && action.online === false) return EMPTY
      // 只快照本次触发时的状态，避免后续状态变更重复触发同一证据上传
      return this.store.select((state) => state.tailings).pipe(
        first(),
        concatMap((tailings) => {
          if (!tailings.online) return EMPTY
          const batches =
            action.type === TailingsActions.resumePendingBatches.type
              ? tailings.dataset.offlineBatches.filter((batch) => batch.status === '证据上传中' && batchHasPendingEvidence(batch))
              : tailings.dataset.offlineBatches.filter((batch) => batch.id === action.batchId)
          const batch = batches[0]
          if (!batch || batch.status !== '证据上传中') return EMPTY

          const pending = batch.evidence.filter((item) => item.uploadState !== '已上传')
          if (pending.length === 0) {
            return of(TailingsActions.finishBatchReconcile({ batchId: batch.id }))
          }
          const evidence = pending[0] as OfflineEvidence
          const willRetry = evidence.attempts > 0
          return this.api.uploadEvidence(batch.id, evidence).pipe(
            map((success) => TailingsActions.evidenceUploadAttempt({
              batchId: batch.id,
              evidenceId: evidence.id,
              success,
              failReason: this.api.lastFailReason
            })),
            catchError((error: Error) => of(TailingsActions.evidenceUploadAttempt({
              batchId: batch.id,
              evidenceId: evidence.id,
              success: false,
              failReason: error.message
            }))),
            // 失败退避更久，成功立即推进；循环回到 retry 继续取下一项
            delay(willRetry ? 900 : 300)
          )
        })
      )
    })
  ))

  /** 每轮上传尝试后继续驱动队列：还有证据则重试/推进，全部完成则由下一 effect 提交对账。 */
  continueUpload$ = createEffect(() => this.actions$.pipe(
    ofType(TailingsActions.evidenceUploadAttempt),
    map(({ batchId }) => TailingsActions.retryFailedEvidence({ batchId }))
  ))

  /** 证据全部上传成功后提交对账；引擎内部保证幂等，重放不新增审计或异常。 */
  reconcileAfterEvidence$ = createEffect(() => this.actions$.pipe(
    ofType(TailingsActions.evidenceUploadAttempt),
    concatMap(({ batchId }) => this.store.select((state) => state.tailings).pipe(
      first(),
      filter((tailings) => {
        const batch = tailings.dataset.offlineBatches.find((item) => item.id === batchId)
        return !!batch && batch.status === '证据上传中' && !batchHasPendingEvidence(batch)
      }),
      map(() => TailingsActions.finishBatchReconcile({ batchId }))
    ))
  ))
}
