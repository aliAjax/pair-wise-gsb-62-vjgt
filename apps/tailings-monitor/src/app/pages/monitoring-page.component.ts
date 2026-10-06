import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import { map } from 'rxjs'
import { selectDataset } from '../store/tailings.selectors'

@Component({
  selector: 'app-monitoring-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatFormFieldModule, MatInputModule, MatTableModule],
  template: `
    <section class="page">
      <div class="page-head"><div><h2>测点与原始读数</h2><p>原始读数只读展示，现场复核和修正以独立版本保存。</p></div><mat-form-field appearance="outline"><mat-label>搜索测点</mat-label><input matInput [(ngModel)]="keyword" /></mat-form-field></div>
      <div class="split">
        <table mat-table [dataSource]="filteredPoints$ | async" class="panel">
          <ng-container matColumnDef="name"><th mat-header-cell *matHeaderCellDef>测点</th><td mat-cell *matCellDef="let row">{{ row.name }}</td></ng-container>
          <ng-container matColumnDef="zone"><th mat-header-cell *matHeaderCellDef>分区</th><td mat-cell *matCellDef="let row">{{ row.zone }}</td></ng-container>
          <ng-container matColumnDef="type"><th mat-header-cell *matHeaderCellDef>类型</th><td mat-cell *matCellDef="let row">{{ row.type }}</td></ng-container>
          <ng-container matColumnDef="value"><th mat-header-cell *matHeaderCellDef>当前值</th><td mat-cell *matCellDef="let row"><b>{{ row.currentValue }} {{ row.unit }}</b></td></ng-container>
          <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>状态</th><td mat-cell *matCellDef="let row"><span class="status" [class.danger]="row.status === '异常'" [class.warning]="row.status === '预警'">{{ row.status }}</span></td></ng-container>
          <tr mat-header-row *matHeaderRowDef="pointColumns"></tr><tr mat-row *matRowDef="let row; columns: pointColumns"></tr>
        </table>
        <div class="panel readings">
          <h3>原始读数与正式值</h3>
          <article *ngFor="let reading of (dataset$ | async)?.readings">
            <div><b>{{ reading.pointId }} · {{ reading.id }}</b><span>{{ reading.quality }} · V{{ reading.revision }} · {{ reading.source }}</span></div>
            <strong>{{ reading.value }} {{ reading.unit }} <em *ngIf="officialValue(reading.id) !== null" class="official">正式值 {{ officialValue(reading.id) }} {{ reading.unit }}</em></strong>
            <small>{{ reading.capturedAt.replace('T', ' ') }} · 设备{{ reading.deviceId }}<span *ngIf="reading.batchId"> · 离线批次{{ reading.batchId }}</span></small>
          </article>
          <article class="revision" *ngFor="let rev of (dataset$ | async)?.officialRevisions">
            <div><b>正式修订 {{ rev.readingId }} V{{ rev.revision }}</b><span>{{ rev.operator }}</span></div>
            <strong>{{ rev.value }} {{ rev.unit }}</strong>
            <small>{{ rev.revisedAt.replace('T', ' ') }} · {{ rev.reason }}</small>
          </article>
          <p>设备原始读数只追加不修改；中心正式修订是权威基线，迟到离线副本不得覆盖，两端同改只保留双方值待核对。</p>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }.page-head h2 { margin: 0 0 5px; font-size: 20px; }.page-head p { margin: 0; color: #72807d; font-size: 12px; }
    .split { display: grid; grid-template-columns: 1fr 330px; gap: 14px; align-items: start; }.panel { background: white; border: 1px solid #d9e1df; } table { width: 100%; }
    .readings { padding: 15px; } .readings h3 { font-size: 14px; margin: 0 0 12px; } .readings article { border-bottom: 1px solid #e2e7e6; padding: 10px 0; display: grid; gap: 4px; }.readings article div { display: flex; justify-content: space-between; color: #667572; font-size: 11px; }.readings small, .readings p { color: #7a8784; font-size: 10px; }.readings small span { color: #2c6a8a; } .official { font-style: normal; color: #2c7352; font-size: 11px; margin-left: 8px; } .revision { background: #f4f8f6; padding: 10px !important; } .status { padding: 3px 7px; background: #e7f3ee; color: #2e765a; border-radius: 3px; font-size: 11px; }.status.warning { background: #f8efd9; color: #936d20; }.status.danger { background: #fae8e6; color: #a43c35; }
  `]
})
export class MonitoringPageComponent {
  private readonly store = inject(Store)
  keyword = ''
  readonly pointColumns = ['name', 'zone', 'type', 'value', 'status']
  readonly dataset$ = this.store.select(selectDataset)
  readonly filteredPoints$ = this.dataset$.pipe(map((dataset) => dataset.points.filter((point) => !this.keyword || `${point.name} ${point.zone} ${point.type} ${point.id}`.includes(this.keyword))))

  officialValue(readingId: string): number | null {
    let value: number | null = null
    this.dataset$.subscribe((dataset) => {
      value = dataset.officialRevisions.find((item) => item.readingId === readingId)?.value ?? null
    }).unsubscribe()
    return value
  }
}
