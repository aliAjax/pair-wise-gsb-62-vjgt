import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { Store } from '@ngrx/store'
import type { EvidenceKind, OfflineBatch, RawReading, TailingsDataset } from '../domain'
import { TailingsActions } from '../store/tailings.actions'
import { selectConflicts, selectDataset, selectOnline, selectSyncMessage } from '../store/tailings.selectors'

@Component({
  selector: 'app-offline-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <section class="page" *ngIf="(dataset$ | async) as dataset">
      <div class="page-head">
        <div><h2>离线巡检批次（断网复测 · 可恢复提交）</h2><p>山谷断网时登记复测值与现场证据；网络恢复后先上传证据、与中心对账合并，再并入原始读数、按阈值版本重算异常。</p></div>
        <div class="net-zone">
          <button mat-stroked-button (click)="toggleOnline()">{{ (online$ | async) ? '模拟断网' : '模拟网络恢复' }}</button>
          <span class="net" [class.offline]="!(online$ | async)"><i></i>{{ (online$ | async) ? '中心在线' : '山谷断网中' }}</span>
        </div>
      </div>

      <div class="sync-message" *ngIf="syncMessage$ | async as message">{{ message }}</div>

      <div class="layout">
        <div class="panel create">
          <h3>1. 建立离线批次</h3>
          <div class="form-row">
            <mat-form-field appearance="outline"><mat-label>巡检员</mat-label><input matInput [(ngModel)]="inspector" /></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>巡检分区</mat-label><input matInput [(ngModel)]="zone" /></mat-form-field>
          </div>
          <button mat-flat-button color="primary" (click)="createBatch()">断网开始：建立批次并冻结阈值快照</button>

          <ng-container *ngIf="activeBatch as batch">
            <h3>2. 断网登记复测值</h3>
            <div class="form-row">
              <mat-form-field appearance="outline"><mat-label>测点（同次读数）</mat-label>
                <mat-select [(ngModel)]="draft.pointId" (ngModelChange)="onPointChange($event, dataset.readings)">
                  <mat-option *ngFor="let point of dataset.points" [value]="point.id">{{ point.id }} · {{ point.name }}</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline"><mat-label>复测值</mat-label><input matInput type="number" [(ngModel)]="draft.value" /></mat-form-field>
            </div>
            <mat-form-field appearance="outline" class="wide"><mat-label>现场说明</mat-label><input matInput [(ngModel)]="draft.note" placeholder="如：坝顶新增细微裂缝，复测两次" /></mat-form-field>
            <div class="hint">针对读数 {{ draft.baseReadingId || '—' }}，单位 {{ unitOf(draft.pointId, dataset) }}；复测作为独立版本，绝不就地覆盖原始读数。</div>
            <button mat-stroked-button (click)="addRemeasure(batch.id)">登记复测</button>

            <h3>3. 留存现场证据</h3>
            <div class="form-row">
              <mat-form-field appearance="outline"><mat-label>证据类型</mat-label>
                <mat-select [(ngModel)]="evidenceDraft.kind"><mat-option *ngFor="let kind of evidenceKinds" [value]="kind">{{ kind }}</mat-option></mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline"><mat-label>证据名称</mat-label><input matInput [(ngModel)]="evidenceDraft.name" placeholder="D01裂缝近照.jpg" /></mat-form-field>
            </div>
            <mat-form-field appearance="outline" class="wide"><mat-label>证据说明</mat-label><input matInput [(ngModel)]="evidenceDraft.note" /></mat-form-field>
            <button mat-stroked-button (click)="addEvidence(batch.id)">留存证据（先存现场）</button>

            <h3>4. 网络恢复后提交</h3>
            <div class="actions">
              <button mat-flat-button color="primary" [disabled]="batch.status !== '离线编辑中' || !batch.evidence.length" (click)="submit(batch.id)">恢复证据并对账提交</button>
              <button mat-stroked-button [disabled]="!batch.evidence.some(hasFailure)" (click)="retry(batch.id)">继续重试失败证据</button>
              <button mat-stroked-button color="warn" (click)="forceFail()">模拟下一次上传失败</button>
            </div>
            <div class="hint">证据全部上传成功后才提交对账；中途刷新页面，恢复后自动续传；重放不产生重复审计。</div>
          </ng-container>

          <h3 class="gap">断网期间中心侧事件（演示对账条件）</h3>
          <div class="form-row">
            <mat-form-field appearance="outline"><mat-label>修订读数</mat-label>
              <mat-select [(ngModel)]="centerBaseId"><mat-option *ngFor="let reading of dataset.readings" [value]="reading.id">{{ reading.id }} · {{ reading.pointId }}（现值 {{ reading.value }} {{ reading.unit }}）</mat-option></mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline"><mat-label>中心正式值</mat-label><input matInput type="number" [(ngModel)]="centerValue" /></mat-form-field>
          </div>
          <div class="actions">
            <button mat-stroked-button (click)="centerRevise()">中心修订正式读数</button>
          </div>
          <div class="form-row gap">
            <mat-form-field appearance="outline"><mat-label>阈值</mat-label>
              <mat-select [(ngModel)]="thresholdId"><mat-option *ngFor="let threshold of dataset.thresholds" [value]="threshold.id">{{ threshold.id }} · {{ threshold.type }}（V{{ threshold.version }} 预警{{ threshold.warning }}/报警{{ threshold.alarm }}）</mat-option></mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline"><mat-label>新报警值</mat-label><input matInput type="number" [(ngModel)]="newAlarm" /></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>新预警值</mat-label><input matInput type="number" [(ngModel)]="newWarning" /></mat-form-field>
          </div>
          <button mat-stroked-button (click)="publishThreshold()">中心发布阈值新版本（对账时失效重算）</button>
        </div>

        <div class="panel batches">
          <h3>离线批次与对账状态</h3>
          <article *ngFor="let batch of dataset.offlineBatches" class="batch" [class.active]="activeBatch?.id === batch.id" (click)="selectBatch(batch.id)">
            <div class="batch-head"><b>{{ batch.id }}</b><span class="status" [class.pending]="batch.status.includes('待核对')">{{ batch.status }}</span></div>
            <small>{{ batch.inspector }} · {{ batch.zone }} · {{ batch.createdAt.replace('T', ' ').slice(0, 16) }}</small>
            <div class="kv"><span>复测 {{ batch.remeasures.length }} 条</span><span>证据 {{ uploaded(batch) }}/{{ batch.evidence.length }}</span></div>
            <div class="kv"><span>阈值版本</span><b>{{ (batch.report?.thresholdVersions ?? batch.thresholdSnapshot).map(versionText).join('、') }}</b></div>
            <ul class="evidence-list">
              <li *ngFor="let item of batch.evidence"><i [class.ok]="item.uploadState === '已上传'" [class.fail]="item.uploadState === '上传失败'"></i>{{ item.kind }}《{{ item.name }}》<em>{{ item.uploadState }}{{ item.attempts ? ' ×' + item.attempts : '' }}</em></li>
            </ul>
            <div class="report" *ngIf="batch.report">
              <p>{{ batch.report.note }}</p>
              <div *ngIf="batch.report.recalculatedAnomalyIds.length">重算异常：{{ batch.report.recalculatedAnomalyIds.join('、') }}</div>
              <div *ngIf="batch.report.openedAnomalyIds.length" class="reopen">重开异常：{{ batch.report.openedAnomalyIds.join('、') }}</div>
            </div>
          </article>
          <div class="empty" *ngIf="!dataset.offlineBatches.length">尚无离线批次。断网开始后在此建立。</div>

          <h3 class="gap">同次读数双值待核对</h3>
          <article *ngFor="let conflict of (conflicts$ | async)" class="conflict">
            <b>{{ conflict.pointId }} · {{ conflict.baseReadingId }}</b>
            <div class="values"><span class="official">中心正式 {{ conflict.officialValue }} {{ conflict.unit }}</span><span class="offline">离线副本 {{ conflict.offlineValue }} {{ conflict.unit }}</span></div>
            <small>正式读数未被覆盖，双方值保留待人工核对（{{ conflict.batchId }}）</small>
          </article>
          <div class="empty" *ngIf="!(conflicts$ | async)?.length">没有待核对冲突。</div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }.page-head h2 { margin: 0 0 5px; font-size: 20px; }.page-head p { margin: 0; color: #72807d; font-size: 12px; max-width: 760px; }
    .net-zone { display: flex; align-items: center; gap: 12px; }.net { display: inline-flex; align-items: center; gap: 6px; color: #2e765a; font-size: 12px; }.net i { width: 8px; height: 8px; border-radius: 50%; background: #3e8a6b; }.net.offline { color: #a43c35; }.net.offline i { background: #b84038; }
    .sync-message { background: #eef5f4; border-left: 3px solid #315d6e; padding: 9px 12px; font-size: 12px; color: #2c4b56; margin-bottom: 12px; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: 14px; align-items: start; }.panel { background: white; border: 1px solid #d9e1df; padding: 16px; }.panel h3 { font-size: 14px; margin: 18px 0 8px; }.panel h3.gap, .gap { margin-top: 24px; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }.form-row:has(mat-form-field:nth-child(3)) { grid-template-columns: 1.4fr 1fr 1fr; }.wide { width: 100%; }.hint { color: #83908d; font-size: 10px; margin: 2px 0 10px; }.actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .batches h3 { margin-top: 0; }.batch { border: 1px solid #e2e7e6; padding: 11px; margin-bottom: 10px; cursor: pointer; display: grid; gap: 5px; }.batch.active { border-color: #315d6e; background: #f3f8f7; }.batch-head { display: flex; justify-content: space-between; align-items: center; }.batch small { color: #7e8b88; font-size: 10px; }.status { background: #e7f3ee; color: #2e765a; padding: 2px 8px; border-radius: 10px; font-size: 10px; }.status.pending { background: #fae8e6; color: #a43c35; }
    .kv { display: flex; justify-content: space-between; font-size: 11px; color: #5f6e6b; }.kv b { font-weight: 600; color: #315d6e; }.evidence-list { list-style: none; padding: 0; margin: 4px 0 0; display: grid; gap: 3px; }.evidence-list li { font-size: 11px; color: #5f6e6b; display: flex; align-items: center; gap: 6px; }.evidence-list em { margin-left: auto; font-style: normal; color: #98a4a0; font-size: 10px; }.evidence-list i { width: 7px; height: 7px; border-radius: 50%; background: #c2ccd0; }.evidence-list i.ok { background: #3e8a6b; }.evidence-list i.fail { background: #b84038; }
    .report { background: #f6f0df; border-left: 3px solid #c99f3d; padding: 8px; font-size: 11px; display: grid; gap: 3px; }.report p { margin: 0; color: #5f5640; }.report .reopen { color: #a43c35; font-weight: 600; }
    .conflict { border: 1px solid #f0d4d1; background: #fdf3f2; padding: 10px; margin-bottom: 8px; display: grid; gap: 5px; }.conflict .values { display: flex; gap: 10px; font-size: 11px; }.conflict .official { color: #2e765a; font-weight: 600; }.conflict .offline { color: #a43c35; }.conflict small { color: #8a6d6b; font-size: 10px; }.empty { color: #98a4a0; font-size: 11px; padding: 8px 0; }
  `]
})
export class OfflinePageComponent {
  private readonly store = inject(Store)
  readonly dataset$ = this.store.select(selectDataset)
  readonly online$ = this.store.select(selectOnline)
  readonly syncMessage$ = this.store.select(selectSyncMessage)
  readonly conflicts$ = this.store.select(selectConflicts)

  readonly evidenceKinds: EvidenceKind[] = ['照片', '视频', '录音', '文档']
  inspector = '巡检员 高原'
  zone = '北沟山谷'
  activeBatchId = ''
  draft = { pointId: 'P-D01', value: 19.2, note: '', baseReadingId: 'RD-1' }
  evidenceDraft = { kind: '照片' as EvidenceKind, name: '', note: '' }
  centerBaseId = 'RD-1'
  centerValue = 17.9
  thresholdId = 'T-D'
  newWarning = 9
  newAlarm = 15

  get activeBatch(): OfflineBatch | undefined {
    let batch: OfflineBatch | undefined
    this.dataset$.subscribe((dataset) => {
      batch = dataset.offlineBatches.find((item) => item.id === this.activeBatchId) ?? dataset.offlineBatches[0]
    }).unsubscribe()
    return batch
  }

  versionText = (s: { thresholdId: string; version: number }): string => `${s.thresholdId} V${s.version}`
  hasFailure = (item: { uploadState: string }): boolean => item.uploadState === '上传失败'
  uploaded(batch: OfflineBatch): number { return batch.evidence.filter((item) => item.uploadState === '已上传').length }

  unitOf(pointId: string, dataset: TailingsDataset): string {
    return dataset.points.find((point) => point.id === pointId)?.unit ?? ''
  }

  onPointChange(pointId: string, readings: RawReading[]): void {
    const latest = readings.filter((item) => item.pointId === pointId && item.reconcileState !== '冲突待核对').sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0]
    this.draft.baseReadingId = latest?.id ?? ''
  }

  selectBatch(id: string): void { this.activeBatchId = id }

  toggleOnline(): void {
    let online = true
    this.online$.subscribe((value) => { online = value }).unsubscribe()
    this.store.dispatch(TailingsActions.setOnline({ online: !online }))
  }

  createBatch(): void {
    this.store.dispatch(TailingsActions.createOfflineBatch({ inspector: this.inspector, zone: this.zone }))
    this.dataset$.subscribe((dataset) => { this.activeBatchId = dataset.offlineBatches[0]?.id ?? '' }).unsubscribe()
  }

  addRemeasure(batchId: string): void {
    if (!this.draft.baseReadingId || Number.isNaN(this.draft.value)) return
    this.store.dispatch(TailingsActions.addRemeasureDraft({ batchId, draft: { ...this.draft } }))
  }

  addEvidence(batchId: string): void {
    if (!this.evidenceDraft.name) return
    this.store.dispatch(TailingsActions.addEvidenceDraft({ batchId, draft: { ...this.evidenceDraft } }))
    this.evidenceDraft.name = ''
    this.evidenceDraft.note = ''
  }

  submit(batchId: string): void { this.store.dispatch(TailingsActions.submitBatchWhenOnline({ batchId })) }
  retry(batchId: string): void { this.store.dispatch(TailingsActions.retryFailedEvidence({ batchId })) }
  forceFail(): void { (globalThis as { __forceNextUploadFail__?: boolean }).__forceNextUploadFail__ = true }

  centerRevise(): void {
    if (!this.centerBaseId || Number.isNaN(this.centerValue)) return
    this.store.dispatch(TailingsActions.centerReviseReading({ baseReadingId: this.centerBaseId, value: this.centerValue }))
  }

  publishThreshold(): void {
    this.store.dispatch(TailingsActions.centerPublishThreshold({ thresholdId: this.thresholdId, warning: this.newWarning, alarm: this.newAlarm }))
  }
}
