import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import { map } from 'rxjs'
import { batchConsistencyView, type TailingsDataset } from '../domain'
import { TailingsApiService } from '../services/tailings-api.service'
import { selectBatchConsistency, selectDataset } from '../store/tailings.selectors'

interface ExportPackage extends TailingsDataset {
  consistencyManifest: ReturnType<typeof buildManifest>
}

const buildManifest = (dataset: TailingsDataset) => ({
  exportedAt: new Date().toISOString(),
  thresholdVersions: dataset.thresholds.map((t) => ({ thresholdId: t.id, version: t.version })),
  batches: dataset.offlineBatches.map((batch) => batchConsistencyView(batch)),
  conflicts: dataset.conflicts.map((conflict) => ({
    batchId: conflict.batchId, pointId: conflict.pointId, readingKey: conflict.readingKey,
    officialValue: conflict.officialValue, offlineValue: conflict.offlineValue, status: conflict.status
  }))
})

@Component({
  selector: 'app-audit-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatTableModule],
  template: `
    <section class="page">
      <div class="head"><div><h2>审计与版本追溯</h2><p>离线批次、原始读数、证据上传、阈值版本与异常重算全部留痕；重放凭幂等键只保留一条审计。</p></div><button mat-flat-button color="primary" (click)="exportPackage()">导出审阅包</button></div>

      <div class="manifest" *ngIf="(batchConsistency$ | async)?.length">
        <h3>对账一致性（与总览、异常详情、导出同源）</h3>
        <table mat-table [dataSource]="batchConsistency$ | async">
          <ng-container matColumnDef="batch"><th mat-header-cell *matHeaderCellDef>批次</th><td mat-cell *matCellDef="let row">{{ row.view.batchId }}</td></ng-container>
          <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>对账状态</th><td mat-cell *matCellDef="let row"><span [class.pending]="row.view.status.includes('待核对')">{{ row.view.status }}</span></td></ng-container>
          <ng-container matColumnDef="threshold"><th mat-header-cell *matHeaderCellDef>阈值版本</th><td mat-cell *matCellDef="let row">{{ row.view.thresholdText }}</td></ng-container>
          <ng-container matColumnDef="note"><th mat-header-cell *matHeaderCellDef>对账说明</th><td mat-cell *matCellDef="let row">{{ row.view.reportNote }}</td></ng-container>
          <tr mat-header-row *matHeaderRowDef="manifestColumns"></tr><tr mat-row *matRowDef="let row; columns: manifestColumns"></tr>
        </table>
      </div>

      <div class="toolbar"><mat-form-field appearance="outline"><mat-label>搜索实体、动作、操作人、批次</mat-label><input matInput [(ngModel)]="keyword" /></mat-form-field><span>共{{ (filtered$ | async)?.length }}条事件</span></div>
      <table mat-table [dataSource]="filtered$ | async" class="panel">
        <ng-container matColumnDef="time"><th mat-header-cell *matHeaderCellDef>时间</th><td mat-cell *matCellDef="let row">{{ row.createdAt.replace('T', ' ').slice(0, 16) }}</td></ng-container>
        <ng-container matColumnDef="batch"><th mat-header-cell *matHeaderCellDef>批次</th><td mat-cell *matCellDef="let row">{{ row.batchId || '—' }}</td></ng-container>
        <ng-container matColumnDef="entity"><th mat-header-cell *matHeaderCellDef>实体</th><td mat-cell *matCellDef="let row">{{ row.entityId }}</td></ng-container>
        <ng-container matColumnDef="action"><th mat-header-cell *matHeaderCellDef>动作</th><td mat-cell *matCellDef="let row">{{ row.action }}</td></ng-container>
        <ng-container matColumnDef="operator"><th mat-header-cell *matHeaderCellDef>操作人</th><td mat-cell *matCellDef="let row">{{ row.operator }}</td></ng-container>
        <ng-container matColumnDef="detail"><th mat-header-cell *matHeaderCellDef>说明</th><td mat-cell *matCellDef="let row">{{ row.detail }}</td></ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }.head h2 { margin: 0 0 5px; font-size: 20px; }.head p { margin: 0; color: #72807d; font-size: 12px; }
    .manifest { background: white; border: 1px solid #d9e1df; padding: 14px; margin-bottom: 14px; }.manifest h3 { margin: 0 0 10px; font-size: 14px; }.manifest span { font-size: 11px; color: #2e765a; }.manifest span.pending { color: #a43c35; }
    .toolbar { display: flex; align-items: center; gap: 12px; margin: 10px 0; }.toolbar span { color: #72827f; font-size: 11px; }.panel { width: 100%; background: white; border: 1px solid #d9e1df; }
  `]
})
export class AuditPageComponent {
  private readonly store = inject(Store)
  private readonly api = inject(TailingsApiService)
  keyword = ''
  readonly columns = ['time', 'batch', 'entity', 'action', 'operator', 'detail']
  readonly manifestColumns = ['batch', 'status', 'threshold', 'note']
  readonly batchConsistency$ = this.store.select(selectBatchConsistency)
  readonly filtered$ = this.store.select(selectDataset).pipe(map((dataset) => dataset.audit.filter((item) => !this.keyword || `${item.entityId} ${item.action} ${item.operator} ${item.detail} ${item.batchId ?? ''}`.includes(this.keyword))))

  exportPackage(): void {
    this.store.select(selectDataset).subscribe((dataset) => {
      const payload: ExportPackage = { ...dataset, consistencyManifest: buildManifest(dataset) }
      this.api.exportPackage(payload as unknown as TailingsDataset).subscribe((blob) => {
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = '尾矿库监测审阅包.json'; anchor.click(); URL.revokeObjectURL(url)
      })
    }).unsubscribe()
  }
}
