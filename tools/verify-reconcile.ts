/* 纯 Node 验证：tsc 编译本脚本后运行，覆盖离线巡检可恢复提交的全部不变量 */
import assert from 'node:assert'
import { seedDataset } from '../apps/tailings-monitor/src/app/data/seed'
import {
  markEvidenceAttempt,
  mergeBatch,
  reconcileBatch,
  recoverBatchStage
} from '../apps/tailings-monitor/src/app/domain/reconcile'
import type { OfflineBatch, TailingsDataset } from '../apps/tailings-monitor/src/app/domain/models'

let passed = 0
const check = (name: string, fn: () => void): void => {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const clone = <T>(v: T): T => structuredClone(v)
const auditCount = (d: TailingsDataset, key: string): number => d.audit.filter((a) => a.idempotencyKey === key).length
const batchOf = (d: TailingsDataset, id: string): OfflineBatch => {
  const b = d.offlineBatches.find((x) => x.id === id)
  if (!b) throw new Error(`batch ${id} missing`)
  return b
}

const BATCH = 'OB-261006-01'
const NOW = '2026-10-06T10:30:00'

console.log('场景0：种子数据')
check('种子含1个断网批次，其中EV-2失败待重试、EV-3待上传，阶段为失败待恢复', () => {
  const b = batchOf(seedDataset, BATCH)
  assert.equal(b.evidence[1].state, '失败待重试')
  assert.equal(b.evidence[2].state, '待上传')
  assert.equal(b.commitStage, '失败待恢复')
  assert.equal(b.thresholdBaseline['T-D'], 4)
})

console.log('\n场景1：上传失败后恢复现场证据并继续重试')
let ds = clone(seedDataset)
check('刷新恢复：上传中(模拟崩溃)的证据回到失败待重试，批次可继续', () => {
  let b = clone(batchOf(ds, BATCH))
  b = markEvidenceAttempt(b, 'EV-3', { ok: false, error: '连接中断' })
  // 模拟进程在“上传中”被杀死
  b.evidence[2].state = '上传中'
  b.commitStage = '证据上传中'
  const recovered = recoverBatchStage(b)
  assert.equal(recovered.evidence[2].state, '失败待重试')
  assert.equal(recovered.commitStage, '失败待恢复')
  assert.ok(recovered.lastError.length > 0)
})
check('续传成功：EV-2、EV-3重试成功后批次进入待对账，已上传证据不重复', () => {
  let b = clone(batchOf(ds, BATCH))
  b = markEvidenceAttempt(b, 'EV-2', { ok: true })
  assert.equal(b.evidence[1].state, '已上传')
  b = markEvidenceAttempt(b, 'EV-3', { ok: true })
  assert.equal(b.commitStage, '待对账')
  // 重复成功动作幂等
  const again = markEvidenceAttempt(b, 'EV-2', { ok: true })
  assert.deepEqual(again.evidence[1].attempts, b.evidence[1].attempts)
})

console.log('\n场景2：先对账，不覆盖中心正式读数')
ds = reconcileBatch(clone(seedDataset), BATCH, NOW)
check('RD-1两端分别修改 → 冲突待核对，保留双方值', () => {
  const line = batchOf(ds, BATCH).reconcileLines.find((l) => l.readingId === 'RD-1')
  assert.equal(line?.status, '冲突待核对')
  assert.equal(line?.offlineValue, 18.7)
  assert.equal(line?.officialValue, 17.4)
})
check('中心正式读数RD-1仍为17.4（official revision），原始值18.7留档', () => {
  const rev = ds.officialRevisions.find((r) => r.readingId === 'RD-1')
  assert.equal(rev?.value, 17.4)
  assert.equal(ds.readings.find((r) => r.id === 'RD-1')?.value, 18.7)
})
check('RD-4离线872.2与中心873.4不一致但中心未修订 → 中心值生效，不冲突', () => {
  const line = batchOf(ds, BATCH).reconcileLines.find((l) => l.readingId === 'RD-4')
  assert.equal(line?.status, '中心值生效')
})
check('RM-3为中心没有的新读数 → 新增读数', () => {
  const line = batchOf(ds, BATCH).reconcileLines.find((l) => l.pointId === 'P-S01')
  assert.equal(line?.status, '新增读数')
})
check('批次状态待核对（有冲突）', () => {
  assert.equal(batchOf(ds, BATCH).reconcileStatus, '待核对')
})
check('对账动作与冲突审计各恰好1条', () => {
  assert.equal(auditCount(ds, 'batch:reconcile:OB-261006-01'), 1)
  assert.equal(auditCount(ds, 'batch:conflict:OB-261006-01:RD-1'), 1)
})

console.log('\n场景3：带冲突仍可合并，中心值不被覆盖')
const beforeAudit = ds.audit.length
let merged = mergeBatch(ds, BATCH, NOW)
check('合并后RD-1正式值仍是17.4，离线18.7只留在对账行中', () => {
  assert.equal(merged.officialRevisions.find((r) => r.readingId === 'RD-1')?.value, 17.4)
  const line = batchOf(merged, BATCH).reconcileLines.find((l) => l.readingId === 'RD-1')
  assert.equal(line?.status, '冲突待核对')
  assert.equal(line?.offlineValue, 18.7)
  assert.equal(line?.officialValue, 17.4)
})
check('新增P-S01读数3.4入库，标记离线批次来源', () => {
  const r = merged.readings.find((r) => r.pointId === 'P-S01')
  assert.equal(r?.value, 3.4)
  assert.equal(r?.source, '离线批次')
  assert.equal(r?.batchId, BATCH)
})
check('P-S01测点状态按新阈值变为异常（3.4≥报警3）', () => {
  assert.equal(merged.points.find((p) => p.id === 'P-S01')?.status, '异常')
})
check('阈值V5高于离场基线V4 → AN-260929-01失效重算且已关闭异常被重新打开', () => {
  const a = merged.anomalies.find((x) => x.id === 'AN-260929-01')!
  assert.equal(a.thresholdVersion, 5)
  assert.equal(a?.status, '原因调查中')
  assert.equal(a?.recomputeState, '重算重开')
  assert.equal(a?.closedAt, '')
  assert.equal(a?.reopenedByBatchId, BATCH)
  assert.ok(a.firstOpenedAt.startsWith('2026-09-29'))
})
check('重开与失效审计各恰好1条', () => {
  assert.equal(auditCount(merged, 'threshold:invalidate:AN-260929-01:v5'), 1)
  assert.equal(auditCount(merged, 'threshold:reopen:AN-260929-01:v5'), 1)
})
check('合并审计与3份证据归档审计各恰好1条', () => {
  assert.equal(auditCount(merged, 'batch:merge:OB-261006-01'), 1)
  assert.equal(auditCount(merged, 'batch:evidence:OB-261006-01:EV-1'), 1)
  assert.equal(auditCount(merged, 'batch:evidence:OB-261006-01:EV-2'), 1)
  assert.equal(auditCount(merged, 'batch:evidence:OB-261006-01:EV-3'), 1)
})
check('批次落账为已合并，记录合并时阈值版本', () => {
  const b = batchOf(merged, BATCH)
  assert.equal(b.commitStage, '已合并')
  assert.equal(b.reconcileStatus, '已合并')
  assert.equal(b.mergedThresholdVersions['T-D'], 5)
  assert.equal(b.mergedAt, NOW)
})
check('合并过程实际新增审计（非零条）', () => {
  assert.ok(merged.audit.length > beforeAudit)
})

console.log('\n场景4：重放幂等——重放不能多出审计记录')
const auditSnapshot = JSON.stringify(merged.audit)
const readingsSnapshot = JSON.stringify(merged.readings)
const replay = mergeBatch(reconcileBatch(merged, BATCH, NOW), BATCH, NOW)
check('再对账+再合并后审计数组完全不变', () => {
  assert.equal(JSON.stringify(replay.audit), auditSnapshot)
})
check('读数不重复追加', () => {
  assert.equal(JSON.stringify(replay.readings), readingsSnapshot)
  const s01 = replay.readings.filter((r) => r.pointId === 'P-S01')
  assert.equal(s01.length, 1)
})
check('各幂等键审计仍只有1条', () => {
  for (const key of [
    'batch:reconcile:OB-261006-01',
    'batch:merge:OB-261006-01',
    'threshold:reopen:AN-260929-01:v5',
    'batch:new-reading:OB-261006-01:RD-OFF-OB-261006-01-P-S01',
    'batch:evidence:OB-261006-01:EV-2'
  ]) {
    assert.equal(auditCount(replay, key), 1, `${key} 出现多次`)
  }
})

console.log('\n场景5：阈值重算使异常失效（放宽阈值）')
check('水位阈值放宽到875后重算，AN-260929-02由调查中变为重算失效', () => {
  const d2 = clone(seedDataset)
  const t = d2.thresholds.find((item) => item.id === 'T-W')!
  t.warning = 874
  t.alarm = 875
  t.version = 4 // 中心在巡检离场后发布V4（放宽：873.4不再越限）
  // 批次基线仍是V3，合并时触发重算；S01新读数仍保留
  const widened = mergeBatch(reconcileBatch(d2, BATCH, NOW), BATCH, NOW)
  const a = widened.anomalies.find((x) => x.id === 'AN-260929-02')
  assert.equal(a?.thresholdVersion, 4)
  assert.equal(a?.recomputeState, '重算失效')
  assert.equal(a?.status, '重算失效')
  assert.equal(auditCount(widened, 'threshold:invalidate:AN-260929-02:v4'), 1)
  assert.equal(auditCount(widened, 'threshold:resolve:AN-260929-02:v4'), 1)
})

console.log(`\n全部 ${passed} 项断言通过`)
