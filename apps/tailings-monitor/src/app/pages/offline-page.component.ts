import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import type { OfflineBatch, Threshold } from '../domain'
import { TailingsActions } from '../store/tailings.actions'
import { selectBatchSummary, selectDataset } from '../store/tailings.selectors'

const NETWORK_STORAGE_KEY = 'tailings-monitor-network-up'

@Component({
  selector: 'app-offline-page',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatTableModule],
  template: `
    <section class="page">
      <div class="head">
        <div>
          <h2>离线巡检批次与可恢复提交</h2>
          <p>断网记录复测值与现场证据 → 续传证据 → 与中心对账（中心正式读数不覆盖）→ 纳入原始读数、阈值版本与异常处置。</p>
        </div>
        <button mat-flat-button [color]="networkUp ? 'primary' : 'warn'" (click)="toggleNetwork()">
          {{ networkUp ? '链路：已恢复（点击模拟断网）' : '链路：中断中（点击恢复）' }}
        </button>
      </div>

      <div class="batch" *ngFor="let summary of summaries$ | async">
        <header>
          <div>
            <h3>{{ summary.batch.id }} · {{ summary.batch.valley }}</h3>
            <span>巡检员 {{ summary.batch.inspector }} · 记录于 {{ summary.batch.recordedAt.replace('T', ' ') }}</span>
          </div>
          <div class="badges">
            <span class="chip" [class.warn]="summary.reconcileStatus === '待核对'" [class.ok]="summary.reconcileStatus === '已合并'">对账：{{ summary.reconcileStatus }}</span>
            <span class="chip" [class.warn]="summary.commitStage === '失败待恢复' || summary.commitStage === '证据上传中'" [class.ok]="summary.commitStage === '已合并'">提交：{{ summary.commitStage }}</span>
            <span class="chip warn" *ngIf="summary.conflicts > 0">双方值待核对 {{ summary.conflicts }}</span>
          </div>
        </header>

        <div class="grid">
          <div class="block">
            <h4>现场证据（断点续传）</h4>
            <table mat-table [dataSource]="summary.batch.evidence">
              <ng-container matColumnDef="name"><th mat-header-cell *matHeaderCellDef>证据</th><td mat-cell *matCellDef="let e">{{ e.kind }} · {{ e.filename }}<small>{{ e.bytes / 1024 / 1024 | number: '1.1' }}MB · {{ e.digest }}</small></td></ng-container>
              <ng-container matColumnDef="state"><th mat-header-cell *matHeaderCellDef>状态</th><td mat-cell *matCellDef="let e"><span class="state" [class.fail]="e.state === '失败待重试'" [class.done]="e.state === '已上传'" [class.ing]="e.state === '上传中'">{{ e.state }}</span><small *ngIf="e.attempts">已尝试{{ e.attempts }}次</small><small class="err" *ngIf="e.lastError">{{ e.lastError }}</small></td></ng-container>
              <ng-container matColumnDef="op"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let e"><button mat-button color="primary" [disabled]="e.state === '已上传' || e.state === '上传中' || !networkUp" (click)="retry(summary.batch.id, e.id)">{{ e.attempts === 0 ? '上传' : '续传重试' }}</button></td></ng-container>
              <tr mat-header-row *matHeaderRowDef="evidenceColumns"></tr><tr mat-row *matRowDef="let row; columns: evidenceColumns"></tr>
            </table>
            <small *ngIf="!networkUp" class="err">链路中断中：证据保留在检查点，恢复后可继续重试，不会丢失或重复归档。</small>
          </div>

          <div class="block">
            <h4>阈值版本（离场基线 → 中心当前）</h4>
            <table mat-table [dataSource]="thresholdRows(summary.batch, (dataset$ | async)?.thresholds ?? [])">
              <ng-container matColumnDef="id"><th mat-header-cell *matHeaderCellDef>阈值</th><td mat-cell *matCellDef="let r">{{ r.id }}（{{ r.type }}）</td></ng-container>
              <ng-container matColumnDef="base"><th mat-header-cell *matHeaderCellDef>离场基线</th><td mat-cell *matCellDef="let r">V{{ r.base }}</td></ng-container>
              <ng-container matColumnDef="now"><th mat-header-cell *matHeaderCellDef>中心当前</th><td mat-cell *matCellDef="let r"><b [class.stale]="r.now > r.base">V{{ r.now }}</b><small class="err" *ngIf="r.now > r.base">合并时相关异常失效重算</small></td></ng-container>
              <tr mat-header-row *matHeaderRowDef="thresholdColumns"></tr><tr mat-row *matRowDef="let row; columns: thresholdColumns"></tr>
            </table>
            <div class="actions">
              <button mat-flat-button color="primary" [disabled]="!canReconcile(summary.batch)" (click)="reconcile(summary.batch.id)">与中心对账</button>
              <button mat-flat-button color="accent" [disabled]="!canMerge(summary.batch)" (click)="merge(summary.batch.id)">对账后合并入库</button>
              <small *ngIf="summary.batch.lastError" class="err">{{ summary.batch.lastError }}</small>
            </div>
            <small *ngIf="summary.batch.mergedAt" class="ok-text">已合并于 {{ summary.batch.mergedAt.replace('T', ' ') }}，重复提交不会多出读数或审计。</small>
          </div>
        </div>

        <div class="block lines" *ngIf="summary.batch.reconcileLines.length">
          <h4>对账行（同一测点同次读数，双方值都保留）</h4>
          <table mat-table [dataSource]="summary.batch.reconcileLines">
            <ng-container matColumnDef="point"><th mat-header-cell *matHeaderCellDef>测点</th><td mat-cell *matCellDef="let l">{{ l.pointId }}</td></ng-container>
            <ng-container matColumnDef="reading"><th mat-header-cell *matHeaderCellDef>同次读数</th><td mat-cell *matCellDef="let l">{{ l.readingId || '（新增）' }}</td></ng-container>
            <ng-container matColumnDef="offline"><th mat-header-cell *matHeaderCellDef>离线复测</th><td mat-cell *matCellDef="let l">{{ l.offlineValue }} {{ l.unit }}</td></ng-container>
            <ng-container matColumnDef="official"><th mat-header-cell *matHeaderCellDef>中心正式</th><td mat-cell *matCellDef="let l">{{ l.officialValue === null ? '—' : l.officialValue + ' ' + l.unit }}</td></ng-container>
            <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>对账结果</th><td mat-cell *matCellDef="let l"><span class="state" [class.conflict]="l.status === '冲突待核对'" [class.done]="l.status === '一致'">{{ l.status }}</span></td></ng-container>
            <ng-container matColumnDef="note"><th mat-header-cell *matHeaderCellDef>说明/核对</th><td mat-cell *matCellDef="let l"><small>{{ l.note }}</small><div class="resolve" *ngIf="l.status === '冲突待核对'"><button mat-button (click)="resolve(summary.batch.id, l.readingId, '确认中心值')">确认中心值</button><button mat-button color="primary" (click)="resolve(summary.batch.id, l.readingId, '登记正式修订')">人工核对后登记正式修订</button></div></td></ng-container>
            <tr mat-header-row *matHeaderRowDef="lineColumns"></tr><tr mat-row *matRowDef="let row; columns: lineColumns" [class.conflict-row]="row.status === '冲突待核对'"></tr>
          </table>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; } .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; } .head h2 { margin: 0 0 5px; font-size: 20px; } .head p { margin: 0; color: #72807d; font-size: 12px; max-width: 760px; }
    .batch { background: white; border: 1px solid #d9e1df; margin-bottom: 16px; } .batch > header { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid #e4eae8; } .batch h3 { margin: 0 0 3px; font-size: 15px; } .batch header span { color: #7a8784; font-size: 11px; }
    .badges { display: flex; gap: 8px; } .chip { padding: 4px 10px; background: #eef3f2; color: #3d5560; font-size: 11px; border-radius: 3px; } .chip.warn { background: #f9e7d3; color: #9a5a1b; } .chip.ok { background: #e4f2ea; color: #2c7352; }
    .grid { display: grid; grid-template-columns: 1.2fr 1fr; } .block { padding: 14px 16px; border-right: 1px solid #edf1f0; } .block:last-child { border-right: 0; } .block h4 { margin: 0 0 10px; font-size: 13px; } .lines { border-top: 1px solid #edf1f0; border-right: 0; }
    td small { display: block; color: #83908d; font-size: 10px; } .err { color: #a4453c !important; } .ok-text { color: #2c7352; }
    .state { padding: 2px 8px; border-radius: 3px; background: #eef3f2; font-size: 11px; } .state.fail { background: #fae8e6; color: #a43c35; } .state.done { background: #e4f2ea; color: #2c7352; } .state.ing { background: #e6eef7; color: #345f8f; } .state.conflict { background: #f9e7d3; color: #9a5a1b; }
    .conflict-row { background: #fdf7f1; } .resolve { display: flex; gap: 6px; margin-top: 4px; } .actions { display: flex; gap: 10px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
    b.stale { color: #a43c35; }
  `]
})
export class OfflinePageComponent {
  private readonly store = inject(Store)
  readonly summaries$ = this.store.select(selectBatchSummary)
  readonly dataset$ = this.store.select(selectDataset)
  readonly evidenceColumns = ['name', 'state', 'op']
  readonly thresholdColumns = ['id', 'base', 'now']
  readonly lineColumns = ['point', 'reading', 'offline', 'official', 'status', 'note']
  networkUp = globalThis.localStorage?.getItem(NETWORK_STORAGE_KEY) !== 'down'

  thresholdRows(batch: OfflineBatch, thresholds: Threshold[]): { id: string; type: string; base: number; now: number }[] {
    return Object.entries(batch.thresholdBaseline).map(([id, base]) => ({
      id,
      type: thresholds.find((t) => t.id === id)?.type ?? '',
      base,
      now: thresholds.find((t) => t.id === id)?.version ?? base
    }))
  }

  canReconcile(batch: OfflineBatch): boolean {
    return batch.evidence.every((e) => e.state === '已上传') &&
      (batch.commitStage === '待对账' || batch.reconcileStatus === '未对账')
  }

  canMerge(batch: OfflineBatch): boolean {
    return batch.reconcileStatus === '已对账' || batch.reconcileStatus === '待核对'
  }

  retry(batchId: string, evidenceId: string): void {
    this.store.dispatch(TailingsActions.uploadEvidence({ batchId, evidenceId }))
  }

  reconcile(batchId: string): void {
    this.store.dispatch(TailingsActions.reconcileBatch({ batchId }))
  }

  merge(batchId: string): void {
    this.store.dispatch(TailingsActions.mergeBatch({ batchId }))
  }

  resolve(batchId: string, readingId: string, resolution: '确认中心值' | '登记正式修订'): void {
    const note = resolution === '登记正式修订'
      ? (globalThis.prompt('登记新的中心正式修订，请填写核对依据', '离线复测经现场基准点复核确认，登记为正式值') ?? '')
      : '人工核对确认中心正式读数为准'
    if (resolution === '登记正式修订' && !note) return
    this.store.dispatch(TailingsActions.resolveReadingConflict({ batchId, readingId, resolution, operator: '值班负责人 何清', note }))
  }

  toggleNetwork(): void {
    this.networkUp = !this.networkUp
    globalThis.localStorage?.setItem(NETWORK_STORAGE_KEY, this.networkUp ? 'up' : 'down')
  }
}
