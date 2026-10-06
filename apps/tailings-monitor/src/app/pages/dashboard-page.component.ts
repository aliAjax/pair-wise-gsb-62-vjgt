import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import { map } from 'rxjs'
import { SpatialMapComponent } from '../components/spatial-map.component'
import { selectAnomalies, selectBatchConsistency, selectDataset, selectPoints } from '../store/tailings.selectors'

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatTableModule, SpatialMapComponent],
  template: `
    <section class="page">
      <div class="metrics">
        <article><span>监测点</span><strong>{{ pointCount$ | async }}</strong><small>位移、水位、渗流、降雨</small></article>
        <article><span>异常点</span><strong>{{ abnormalCount$ | async }}</strong><small>阈值引擎自动标记</small></article>
        <article><span>待审异常</span><strong>{{ openAnomalyCount$ | async }}</strong><small>含阈值变化重开</small></article>
        <article><span>离线批次</span><strong>{{ batchCount$ | async }}</strong><small>断网复测·可恢复对账</small></article>
      </div>
      <app-spatial-map [points]="(points$ | async) ?? []" />

      <div class="reconcile-band" *ngIf="(batchConsistency$ | async)?.length">
        <h2>离线批次对账状态</h2>
        <table mat-table [dataSource]="batchConsistency$ | async">
          <ng-container matColumnDef="batch"><th mat-header-cell *matHeaderCellDef>批次</th><td mat-cell *matCellDef="let row"><b>{{ row.view.batchId }}</b></td></ng-container>
          <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>对账状态</th><td mat-cell *matCellDef="let row"><span class="status" [class.pending]="row.view.status.includes('待核对')">{{ row.view.status }}</span></td></ng-container>
          <ng-container matColumnDef="threshold"><th mat-header-cell *matHeaderCellDef>阈值版本</th><td mat-cell *matCellDef="let row">{{ row.view.thresholdText }}</td></ng-container>
          <ng-container matColumnDef="evidence"><th mat-header-cell *matHeaderCellDef>证据上传</th><td mat-cell *matCellDef="let row">{{ row.view.evidenceUploaded }}/{{ row.view.evidenceTotal }}</td></ng-container>
          <ng-container matColumnDef="note"><th mat-header-cell *matHeaderCellDef>对账说明</th><td mat-cell *matCellDef="let row">{{ row.view.reportNote }}</td></ng-container>
          <tr mat-header-row *matHeaderRowDef="batchColumns"></tr><tr mat-row *matRowDef="let row; columns: batchColumns"></tr>
        </table>
      </div>

      <div class="threshold-band">
        <div><h2>阈值与运行方式</h2><p>报警阈值、变化速率和监测频率按坝体分区执行；版本变化后相关异常在离线批次对账时失效重算。</p></div>
        <table mat-table [dataSource]="(dataset$ | async)?.thresholds ?? []">
          <ng-container matColumnDef="type"><th mat-header-cell *matHeaderCellDef>类型</th><td mat-cell *matCellDef="let row">{{ row.type }}</td></ng-container>
          <ng-container matColumnDef="warning"><th mat-header-cell *matHeaderCellDef>预警</th><td mat-cell *matCellDef="let row">{{ row.warning }} {{ row.unit }}</td></ng-container>
          <ng-container matColumnDef="alarm"><th mat-header-cell *matHeaderCellDef>报警</th><td mat-cell *matCellDef="let row">{{ row.alarm }} {{ row.unit }}</td></ng-container>
          <ng-container matColumnDef="rate"><th mat-header-cell *matHeaderCellDef>变化率</th><td mat-cell *matCellDef="let row">{{ row.changeRate }} {{ row.unit }}</td></ng-container>
          <ng-container matColumnDef="version"><th mat-header-cell *matHeaderCellDef>版本</th><td mat-cell *matCellDef="let row">V{{ row.version }}</td></ng-container>
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
    .reconcile-band { background: white; border: 1px solid #d9e1df; margin-top: 15px; padding: 16px; } .reconcile-band h2 { margin: 0 0 10px; font-size: 16px; } .status { padding: 2px 8px; border-radius: 10px; background: #e7f3ee; color: #2e765a; font-size: 11px; } .status.pending { background: #fae8e6; color: #a43c35; }
    .threshold-band { background: white; border: 1px solid #d9e1df; margin-top: 15px; padding: 16px; } .threshold-band h2 { margin: 0 0 5px; font-size: 17px; } .threshold-band p { color: #72807d; font-size: 12px; margin: 0 0 12px; } table { width: 100%; }
  `]
})
export class DashboardPageComponent {
  private readonly store = inject(Store)
  readonly points$ = this.store.select(selectPoints)
  readonly anomalies$ = this.store.select(selectAnomalies)
  readonly dataset$ = this.store.select(selectDataset)
  readonly batchConsistency$ = this.store.select(selectBatchConsistency)
  readonly pointCount$ = this.points$.pipe(map((points) => points.length))
  readonly abnormalCount$ = this.points$.pipe(map((points) => points.filter((point) => point.status !== '正常').length))
  readonly openAnomalyCount$ = this.anomalies$.pipe(map((items) => items.filter((item) => item.status !== '已关闭').length))
  readonly batchCount$ = this.batchConsistency$.pipe(map((items) => items.length))
  readonly thresholdColumns = ['type', 'warning', 'alarm', 'rate', 'version']
  readonly batchColumns = ['batch', 'status', 'threshold', 'evidence', 'note']
}
