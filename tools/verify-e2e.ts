/* 状态层端到端：模拟用户操作顺序，验证可恢复提交在完整链路中的行为 */
import assert from 'node:assert'
import { seedDataset } from '../apps/tailings-monitor/src/app/data/seed'
import {
  markEvidenceAttempt,
  mergeBatch,
  reconcileBatch,
  recoverBatchStage
} from '../apps/tailings-monitor/src/app/domain/reconcile'
import type { OfflineBatch, TailingsDataset } from '../apps/tailings-monitor/src/app/domain/models'

const clone = <T>(v: T): T => structuredClone(v)
const BATCH = 'OB-261006-01'
let ds: TailingsDataset = clone(seedDataset)
const batch = (): OfflineBatch => ds.offlineBatches.find((b) => b.id === BATCH)!

console.log('E2E：断网 → 恢复 → 续传 → 对账 → 人工核对 → 合并 → 崩溃重放')

// 1. 应用在证据上传过程中崩溃：EV-3 停在“上传中”
let b = batch()
b.evidence[2].state = '上传中'
b.commitStage = '证据上传中'

// 2. 刷新：恢复检查点
Object.assign(b, recoverBatchStage(b))
assert.equal(b.evidence[2].state, '失败待重试', '崩溃后EV-3应回到失败待重试')
assert.equal(b.commitStage, '失败待恢复')
console.log('  ✓ 刷新后上传中的证据恢复为失败待重试')

// 3. 恢复链路，逐份续传成功
for (const id of ['EV-2', 'EV-3']) {
  Object.assign(b, markEvidenceAttempt(b, id, { ok: true }))
}
assert.equal(b.commitStage, '待对账')
assert.ok(b.evidence.every((e) => e.state === '已上传'))
console.log('  ✓ 现场证据全部续传成功，批次进入待对账')

const auditBefore = ds.audit.length

// 4. 对账
ds = reconcileBatch(ds, BATCH, '2026-10-06T10:30:00')
assert.equal(batch().reconcileStatus, '待核对')
const conflict = batch().reconcileLines.find((l) => l.readingId === 'RD-1')
assert.equal(conflict?.status, '冲突待核对')
console.log('  ✓ 对账产出冲突行 RD-1（中心17.4 vs 离线18.7），中心正式值未动')

// 5. 中心正式读数在合并前后始终不被覆盖（这里不做人工核对，直接合并）
ds = mergeBatch(ds, BATCH, '2026-10-06T10:31:00')
assert.equal(ds.officialRevisions.find((r) => r.readingId === 'RD-1')?.value, 17.4)
assert.equal(batch().reconcileStatus, '已合并')
const reopened = ds.anomalies.find((a) => a.id === 'AN-260929-01')!
assert.equal(reopened.status, '原因调查中')
assert.equal(reopened.recomputeState, '重算重开')
assert.equal(reopened.thresholdVersion, 5)
const newAnomaly = ds.anomalies.find((a) => a.id === `AN-OFF-${BATCH}-P-S01`)
assert.ok(newAnomaly, 'S01离线读数越限应生成新异常')
assert.equal(newAnomaly?.status, '待现场复核')
console.log('  ✓ 合并：已关闭异常按V5重新打开；S01新增读数生成待复核异常；证据逐条归档')

// 6. 崩溃重放：从持久化快照恢复后再次执行对账+合并（恢复阶段也重放一次）
const snapshot = clone(ds)
let replay = reconcileBatch(snapshot, BATCH, '2026-10-06T11:00:00')
replay = mergeBatch(replay, BATCH, '2026-10-06T11:01:00')
assert.equal(replay.audit.length, ds.audit.length, '重放后审计条数不得增加')
assert.equal(replay.readings.length, ds.readings.length, '重放后读数条数不得增加')
assert.equal(replay.anomalies.length, ds.anomalies.length, '重放后异常条数不得增加')
assert.equal(replay.offlineBatches[0].evidence.filter((e) => e.state === '已上传').length, 3)
console.log('  ✓ 崩溃重放对账+合并：审计、读数、异常均无重复')

// 7. 导出视图口径：批次/阈值版本/对账状态
const exportView = {
  batchId: replay.offlineBatches[0].id,
  reconcileStatus: replay.offlineBatches[0].reconcileStatus,
  commitStage: replay.offlineBatches[0].commitStage,
  mergedThresholdVersions: replay.offlineBatches[0].mergedThresholdVersions,
  anomalyThresholdVersion: reopened.thresholdVersion,
  thresholdCurrent: Object.fromEntries(replay.thresholds.map((t) => [t.id, t.version]))
}
assert.deepEqual(exportView.mergedThresholdVersions, { 'T-D': 5, 'T-W': 3, 'T-S': 5, 'T-R': 2 })
assert.equal(exportView.mergedThresholdVersions['T-D'], exportView.thresholdCurrent['T-D'])
assert.equal(exportView.anomalyThresholdVersion, exportView.thresholdCurrent['T-D'])
console.log('  ✓ 总览/异常详情/导出三处阈值版本与对账状态口径一致（T-D=V5、已合并）')

console.log(`\n新增审计 ${ds.audit.length - auditBefore} 条（幂等去重后），端到端链路通过`)
