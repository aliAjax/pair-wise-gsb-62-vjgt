import { Injectable, inject } from '@angular/core'
import { Actions, ROOT_EFFECTS_INIT, createEffect, ofType } from '@ngrx/effects'
import { Store } from '@ngrx/store'
import { catchError, delay, map, of, switchMap, tap, withLatestFrom } from 'rxjs'
import { TailingsApiService } from '../services/tailings-api.service'
import type { TailingsDataset } from '../domain'
import { TailingsActions } from './tailings.actions'
import { STORAGE_KEY } from './tailings.reducer'
import { selectDataset } from './tailings.selectors'

/** 可恢复提交演示用的“网络”开关；真实环境替换为上传接口与重试队列 */
const NETWORK_STORAGE_KEY = 'tailings-monitor-network-up'

@Injectable()
export class TailingsEffects {
  private readonly actions$ = inject(Actions)
  private readonly api = inject(TailingsApiService)
  private readonly store = inject(Store)

  loadDataset$ = createEffect(() => this.actions$.pipe(
    ofType(TailingsActions.loadDataset),
    switchMap(() => this.api.loadDataset().pipe(
      map((dataset) => TailingsActions.loadDatasetSuccess({ dataset })),
      catchError((error: Error) => of(TailingsActions.loadDatasetFailure({ error: error.message })))
    ))
  ))

  /** 应用启动：恢复所有中断在“上传中”的证据检查点，然后从断点继续提交 */
  recoverOnBoot$ = createEffect(() => this.actions$.pipe(
    ofType(ROOT_EFFECTS_INIT),
    map(() => TailingsActions.recoverPendingCommits())
  ))

  /** 模拟现场证据上传：小文件快、大文件慢；断网时失败，证据保留可继续重试 */
  uploadEvidence$ = createEffect(() => this.actions$.pipe(
    ofType(TailingsActions.uploadEvidence),
    switchMap(({ batchId, evidenceId }) => {
      const networkUp = globalThis.localStorage?.getItem(NETWORK_STORAGE_KEY) !== 'down'
      const latency = 450 + Math.floor(Math.random() * 500)
      return of(networkUp).pipe(
        delay(latency),
        map((up) => up
          ? TailingsActions.uploadEvidenceDone({ batchId, evidenceId, ok: true })
          : TailingsActions.uploadEvidenceDone({ batchId, evidenceId, ok: false, error: '山谷链路中断，证据已保留，等待恢复续传' }))
      )
    })
  ))

  /** 每次状态变化后持久化快照，崩溃/刷新后可从检查点恢复 */
  persist$ = createEffect(() => this.actions$.pipe(
    withLatestFrom(this.store.select(selectDataset)),
    tap(([, dataset]: [unknown, TailingsDataset]) => {
      try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(dataset)) } catch { /* 配额不足时忽略 */ }
    })
  ), { functional: false, dispatch: false })
}
