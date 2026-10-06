import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import { map } from 'rxjs'
import { SpatialMapComponent } from '../components/spatial-map.component'
import type { Threshold } from '../domain'
import { TailingsActions } from '../store/tailings.actions'
import { selectAnomalies, selectBatchSummary, selectDataset, selectPoints } from '../store/tailings.selectors'

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatTableModule, SpatialMapComponent],
  template: `
    <section class="page">
      <div class="metrics">
        <article><span>监测点</span><strong>{{ pointCount$ | async }}</strong><small>位移、水位、渗流、降雨</small></article>
        <article><span>异常点</span><strong>{{ abnormalCount$ | async }}</strong><small>阈值引擎自动标记</small></article>
        <article><span>待办异常</span><strong>{{ openAnomalyCount$ | async }}</strong><small>含阈值重算重新打开</small></article>
        <article><span>阈值版本</span><strong>{{ thresholdVersion$ | async }}</strong><small>升版后相关异常失效重算</small></article>
      </div>

      <div class="reconcile-band">
        <h2>离线巡检批次对账总览</h2>
        <p>总览、异常详情与导出共用同一份批次、阈值版本与对账状态。</p>
        <table mat-table [dataSource]="summaries$ | async">
          <ng-container matColumnDef="id"><th mat-header-cell *matHeaderCellDef>批次</th><td mat-cell *matCellDef="let s"><b>{{ s.batch.id }}</b><small>{{ s.batch.valley }} · {{ s.batch.inspector }}</small></td></ng-container>
          <ng-container matColumnDef="evidence"><th mat-header-cell *matHeaderCellDef>现场证据</th><td mat-cell *matCellDef="let s">{{ s.evidenceUploaded }}/{{ s.evidenceTotal }}<small [class.err]="s.evidenceFailed > 0">{{ s.evidenceFailed ? s.evidenceFailed + '份待续传' : '全部归档' }}</small></td></ng-container>
          <ng-container matColumnDef="reconcile"><th mat-header-cell *matHeaderCellDef>对账状态</th><td mat-cell *matCellDef="let s"><span [class.warn]="s.reconcileStatus === '待核对'" [class.ok]="s.reconcileStatus === '已合并'">{{ s.reconcileStatus }}</span><small *ngIf="s.conflicts">冲突待核对 {{ s.conflicts }} · 新增 {{ s.newReadings }}</small></td></ng-container>
          <ng-container matColumnDef="stage"><th mat-header-cell *matHeaderCellDef>提交阶段</th><td mat-cell *matCellDef="let s">{{ s.commitStage }}<small *ngIf="s.mergedAt">合并于 {{ s.mergedAt.replace('T', ' ').slice(0, 16) }}</small></td></ng-container>
          <ng-container matColumnDef="threshold"><th mat-header-cell *matHeaderCellDef>阈值版本</th><td mat-cell *matCellDef="let s"><span *ngFor="let d of s.thresholdDelta" class="stale">{{ d.id }} V{{ d.base }}→V{{ d.now }} </span><small *ngIf="!s.thresholdDelta.length">无升版</small></td></ng-container>
          <tr mat-header-row *matHeaderRowDef="summaryColumns"></tr><tr mat-row *matRowDef="let row; columns: summaryColumns"></tr>
        </table>
      </div>

      <app-spatial-map [points]="(points$ | async) ?? []" />
      <div class="threshold-band">
        <div><h2>阈值与运行方式</h2><p>中心调整阈值即发布新版本；相关异常（含已关闭）按新版本失效重算。</p></div>
        <table mat-table [dataSource]="(dataset$ | async)?.thresholds ?? []">
          <ng-container matColumnDef="type"><th mat-header-cell *matHeaderCellDef>类型</th><td mat-cell *matCellDef="let row">{{ row.type }}</td></ng-container>
          <ng-container matColumnDef="warning"><th mat-header-cell *matHeaderCellDef>预警</th><td mat-cell *matCellDef="let row">{{ row.warning }} {{ row.unit }}</td></ng-container>
          <ng-container matColumnDef="alarm"><th mat-header-cell *matHeaderCellDef>报警</th><td mat-cell *matCellDef="let row">{{ row.alarm }} {{ row.unit }}</td></ng-container>
          <ng-container matColumnDef="rate"><th mat-header-cell *matHeaderCellDef>变化率</th><td mat-cell *matCellDef="let row">{{ row.changeRate }} {{ row.unit }}</td></ng-container>
          <ng-container matColumnDef="version"><th mat-header-cell *matHeaderCellDef>版本</th><td mat-cell *matCellDef="let row">V{{ row.version }}</td></ng-container>
          <ng-container matColumnDef="bump"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let row"><button mat-button color="primary" (click)="bump(row)">发布新版本</button></td></ng-container>
          <tr mat-header-row *matHeaderRowDef="thresholdColumns"></tr><tr mat-row *matRowDef="let row; columns: thresholdColumns"></tr>
        </table>
      </div>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); background: white; border: 1px solid #d9e1df; margin-bottom: 15px; }
    .metrics article { padding: 17px 19px; border-right: 1px solid #e2e8e6; } .metrics article:last-child { border: 0; }
    .metrics span, .metrics strong, .metrics small { display: block; } .metrics span { color: #72807d; font-size: 12px; } .metrics strong { font-size: 27px; color: #245060; margin: 6px 0; } .metrics small { color: #98a4a0; font-size: 10px; }
    .reconcile-band { background: white; border: 1px solid #d9e1df; margin-bottom: 15px; padding: 16px; } .reconcile-band h2 { margin: 0 0 5px; font-size: 17px; } .reconcile-band p { color: #72807d; font-size: 12px; margin: 0 0 12px; } table { width: 100%; }
    td small { display: block; color: #83908d; font-size: 10px; } .err { color: #a4453c; } .warn { color: #9a5a1b; font-weight: 600; } .ok { color: #2c7352; font-weight: 600; } .stale { color: #a43c35; margin-right: 8px; font-size: 11px; }
    .threshold-band { background: white; border: 1px solid #d9e1df; margin-top: 15px; padding: 16px; } .threshold-band h2 { margin: 0 0 5px; font-size: 17px; } .threshold-band p { color: #72807d; font-size: 12px; margin: 0 0 12px; }
  `]
})
export class DashboardPageComponent {
  private readonly store = inject(Store)
  readonly points$ = this.store.select(selectPoints)
  readonly anomalies$ = this.store.select(selectAnomalies)
  readonly dataset$ = this.store.select(selectDataset)
  readonly summaries$ = this.store.select(selectBatchSummary)
  readonly pointCount$ = this.points$.pipe(map((points) => points.length))
  readonly abnormalCount$ = this.points$.pipe(map((points) => points.filter((point) => point.status !== '正常').length))
  readonly openAnomalyCount$ = this.anomalies$.pipe(map((items) => items.filter((item) => item.status !== '已关闭' && item.status !== '重算失效').length))
  readonly thresholdVersion$ = this.dataset$.pipe(map((dataset) => dataset.thresholds.reduce((sum, item) => sum + item.version, 0)))
  readonly summaryColumns = ['id', 'evidence', 'reconcile', 'stage', 'threshold']
  readonly thresholdColumns = ['type', 'warning', 'alarm', 'rate', 'version', 'bump']

  bump(row: Threshold): void {
    const input = globalThis.prompt(
      `发布「${row.type}」新阈值版本（当前预警${row.warning}/报警${row.alarm}/变化率${row.changeRate}）。\n输入 预警,报警,变化率（留空=限值不变仅升版）`,
      `${row.warning},${row.alarm},${row.changeRate}`
    )
    if (input === null) return
    const patch: Partial<Pick<Threshold, 'warning' | 'alarm' | 'changeRate'>> = {}
    const parts = input.split(',').map((v) => Number.parseFloat(v.trim()))
    if (parts.length === 3 && parts.every((v) => Number.isFinite(v))) {
      patch.warning = parts[0]
      patch.alarm = parts[1]
      patch.changeRate = parts[2]
    }
    this.store.dispatch(TailingsActions.bumpThreshold({ thresholdId: row.id, patch, operator: '监测中心' }))
  }
}
