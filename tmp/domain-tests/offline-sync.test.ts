import assert from 'node:assert/strict'
import { seedDataset } from '../../apps/tailings-monitor/src/app/data/seed'
import type { TailingsDataset } from '../../apps/tailings-monitor/src/app/domain'
import {
  addEvidence,
  addRemeasure,
  applyEvidenceUploadResult,
  createIdFactory,
  createOfflineBatch,
  latestEffectiveReading,
  markBatchSyncing,
  publishThreshold,
  reconcileBatch,
  reviseCenterReading,
  batchConsistencyView
} from '../../apps/tailings-monitor/src/app/domain'

let passed = 0
const check = (name: string, fn: () => void): void => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

// 固定时钟与ID工厂，保证重放结果可逐字段比较
let tick = 0
const clock = (): string => `2026-10-06T0${1 + Math.floor(tick++ / 60)}:${String(tick % 60).padStart(2, '0')}:00.000Z`
const ids = createIdFactory(1)

const buildOfflineBatch = (): { dataset: TailingsDataset; batchId: string } => {
  const created = createOfflineBatch(structuredClone(seedDataset), '巡检员 高原', '北沟山谷', clock, createIdFactory(1))
  return { dataset: created.dataset, batchId: created.batch.id }
}

console.log('1. 断网登记与证据留存')
{
  let { dataset, batchId } = buildOfflineBatch()
  check('建立批次即冻结阈值版本快照', () => {
    const batch = dataset.offlineBatches[0]
    assert.equal(batch.thresholdSnapshot.find((s) => s.thresholdId === 'T-D')?.version, 4)
    assert.equal(batch.status, '离线编辑中')
    assert.match(dataset.audit[0].detail, /T-D V4/)
  })
  dataset = addRemeasure(dataset, batchId, { pointId: 'P-D01', baseReadingId: 'RD-1', value: 19.2, note: '现场复测' }, clock, createIdFactory(10))
  dataset = addEvidence(dataset, batchId, { kind: '照片', name: 'D01裂缝近照.jpg', note: '坝顶' }, clock, createIdFactory(20))
  check('复测与证据离线挂到批次，不改动原始读数', () => {
    const batch = dataset.offlineBatches[0]
    assert.equal(batch.remeasures.length, 1)
    assert.equal(batch.evidence.length, 1)
    assert.equal(batch.evidence[0].uploadState, '待上传')
    const rd1 = dataset.readings.find((r) => r.id === 'RD-1')
    assert.equal(rd1?.value, 18.7)
    assert.equal(dataset.readings.filter((r) => r.origin === '离线复测').length, 0)
  })
}

console.log('2. 两端分别修改同次读数：中心正式值不被覆盖')
{
  let { dataset, batchId } = buildOfflineBatch()
  // 巡检员在山谷断网复测 D01
  dataset = addRemeasure(dataset, batchId, { pointId: 'P-D01', baseReadingId: 'RD-1', value: 19.2 }, clock, createIdFactory(10))
  dataset = addEvidence(dataset, batchId, { kind: '照片', name: 'd01.jpg' }, clock, createIdFactory(20))
  // 网络恢复前，中心对同一次读数做了正式修订
  dataset = reviseCenterReading(dataset, 'RD-1', 17.9, '中心值班员', clock, createIdFactory(30))
  dataset = markBatchSyncing(dataset, batchId)
  const evidenceId = dataset.offlineBatches[0].evidence[0].id
  dataset = applyEvidenceUploadResult(dataset, batchId, evidenceId, true, '', clock, createIdFactory(40))
  const before = structuredClone(dataset)
  dataset = reconcileBatch(dataset, batchId, clock, createIdFactory(50))

  check('离线副本并入但标记冲突待核对，中心正式值仍生效', () => {
    const latest = latestEffectiveReading(dataset.readings, 'P-D01')
    assert.equal(latest?.value, 17.9)
    assert.equal(latest?.origin, '中心修订')
    const offlineCopy = dataset.readings.find((r) => r.origin === '离线复测')
    assert.equal(offlineCopy?.value, 19.2)
    assert.equal(offlineCopy?.reconcileState, '冲突待核对')
    assert.equal(offlineCopy?.baseReadingId, 'RD-1')
  })
  check('冲突记录只保留双方值，批次进入“已对账·待核对”', () => {
    assert.equal(dataset.conflicts.length, 1)
    const conflict = dataset.conflicts[0]
    assert.equal(conflict.officialValue, 17.9)
    assert.equal(conflict.offlineValue, 19.2)
    assert.equal(conflict.status, '冲突待核对')
    assert.equal(dataset.offlineBatches[0].status, '已对账·待核对')
  })
  check('原读数RD-1和中心修订版本均被保留', () => {
    assert.equal(dataset.readings.find((r) => r.id === 'RD-1')?.value, 18.7)
    assert.ok(dataset.readings.some((r) => r.origin === '中心修订' && r.value === 17.9))
  })
  check('重放对账是幂等 no-op，状态与审计不变化', () => {
    const auditCount = dataset.audit.length
    const replayed = reconcileBatch(dataset, batchId, clock, createIdFactory(999))
    assert.equal(replayed, dataset)
    assert.equal(dataset.audit.length, auditCount)
  })
}

console.log('3. 无冲突时离线复测正常并入')
{
  let { dataset, batchId } = buildOfflineBatch()
  dataset = addRemeasure(dataset, batchId, { pointId: 'P-D02', baseReadingId: 'RD-5', value: 9.8 }, clock, createIdFactory(10))
  dataset = addEvidence(dataset, batchId, { kind: '文档', name: 'd02-note.pdf' }, clock, createIdFactory(20))
  dataset = markBatchSyncing(dataset, batchId)
  const evidenceId = dataset.offlineBatches[0].evidence[0].id
  dataset = applyEvidenceUploadResult(dataset, batchId, evidenceId, true, '', clock, createIdFactory(40))
  dataset = reconcileBatch(dataset, batchId, clock, createIdFactory(50))
  check('复测作为独立版本并入原始读数，批次正常对账完成', () => {
    const merged = dataset.readings.find((r) => r.origin === '离线复测')
    assert.equal(merged?.value, 9.8)
    assert.equal(merged?.reconcileState, '已并入')
    assert.equal(dataset.readings.find((r) => r.id === 'RD-5')?.value, 9.4)
    assert.equal(dataset.conflicts.length, 0)
    assert.equal(dataset.offlineBatches[0].status, '已对账')
  })
}

console.log('4. 阈值版本变化：相关异常失效重算，已关闭异常重新打开')
{
  let { dataset, batchId } = buildOfflineBatch()
  dataset = addRemeasure(dataset, batchId, { pointId: 'P-D02', baseReadingId: 'RD-5', value: 18.2 }, clock, createIdFactory(10))
  dataset = addEvidence(dataset, batchId, { kind: '视频', name: 'd02-run.mp4' }, clock, createIdFactory(20))
  // 断网期间中心发布 T-D V5：报警值由16收紧到15
  dataset = publishThreshold(dataset, 'T-D', { warning: 9, alarm: 15 }, '阈值管理员', clock, createIdFactory(30))
  dataset = markBatchSyncing(dataset, batchId)
  const evidenceId = dataset.offlineBatches[0].evidence[0].id
  dataset = applyEvidenceUploadResult(dataset, batchId, evidenceId, true, '', clock, createIdFactory(40))
  dataset = reconcileBatch(dataset, batchId, clock, createIdFactory(50))

  check('已关闭的 D02 历史异常按新阈值失效并重新打开', () => {
    const closed = dataset.anomalies.find((a) => a.id === 'AN-260927-03')
    assert.equal(closed?.status, '重算重开')
    assert.equal(closed?.closedAt, '')
    assert.equal(closed?.recalcState, '阈值失效·重开')
    assert.equal(closed?.thresholdVersion, 'T-D V5')
    assert.ok(closed.version > 5)
  })
  check('处置中/审批中的相关异常同样重算', () => {
    const d01 = dataset.anomalies.find((a) => a.id === 'AN-260929-01')
    assert.equal(d01?.status, '重算重开')
    assert.match(d01?.recalcNote ?? '', /V5/)
  })
  check('不相关测点（水位/渗流）的异常不被重算', () => {
    const water = dataset.anomalies.find((a) => a.id === 'AN-260929-02')
    assert.equal(water?.status, '原因调查中')
    assert.equal(water?.recalcState, '')
  })
  check('对账报告记录重算/重开清单与阈值版本', () => {
    const report = dataset.offlineBatches[0].report
    assert.ok(report?.recalculatedAnomalyIds.includes('AN-260927-03'))
    assert.ok(report?.openedAnomalyIds.includes('AN-260927-03'))
    assert.equal(report?.thresholdVersions.find((s) => s.thresholdId === 'T-D')?.version, 5)
  })
  check('新阈值下不再超限的异常会失效关闭', () => {
    let local = structuredClone(seedDataset)
    const c = createOfflineBatch(local, 'x', 'y', clock, createIdFactory(1))
    local = c.dataset
    local = addRemeasure(local, c.batch.id, { pointId: 'P-D02', baseReadingId: 'RD-5', value: 9.4 }, clock, createIdFactory(10))
    local = addEvidence(local, c.batch.id, { kind: '照片', name: 'x.jpg' }, clock, createIdFactory(20))
    local = publishThreshold(local, 'T-D', { warning: 12, alarm: 20 }, '阈值管理员', clock, createIdFactory(30))
    local = markBatchSyncing(local, c.batch.id)
    const ev = local.offlineBatches[0].evidence[0].id
    local = applyEvidenceUploadResult(local, c.batch.id, ev, true, '', clock, createIdFactory(40))
    local = reconcileBatch(local, c.batch.id, clock, createIdFactory(50))
    const closedAnomaly = local.anomalies.find((a) => a.id === 'AN-260927-03')
    assert.equal(closedAnomaly?.status, '已关闭')
    assert.equal(closedAnomaly?.recalcState, '阈值失效·关闭')
  })
}

console.log('5. 证据上传失败后恢复重试；重放不产生多余审计')
{
  let { dataset, batchId } = buildOfflineBatch()
  dataset = addEvidence(dataset, batchId, { kind: '照片', name: 'ev1.jpg' }, clock, createIdFactory(20))
  dataset = addEvidence(dataset, batchId, { kind: '录音', name: 'ev2.m4a' }, clock, createIdFactory(21))
  dataset = markBatchSyncing(dataset, batchId)
  const [ev1, ev2] = dataset.offlineBatches[0].evidence
  dataset = applyEvidenceUploadResult(dataset, batchId, ev1.id, false, '卫星链路抖动', clock, createIdFactory(40))
  check('失败时现场证据保留并记录原因，且没有成功审计', () => {
    const stored = dataset.offlineBatches[0].evidence.find((e) => e.id === ev1.id)
    assert.equal(stored?.uploadState, '上传失败')
    assert.equal(stored?.failReason, '卫星链路抖动')
    assert.equal(stored?.attempts, 1)
    assert.equal(dataset.audit.filter((a) => a.action === '现场证据上传').length, 0)
  })
  check('证据未全部上传时对账不可提交（可恢复，不产生半批次）', () => {
    const blocked = reconcileBatch(dataset, batchId, clock, createIdFactory(50))
    assert.equal(blocked, dataset)
    assert.equal(dataset.offlineBatches[0].status, '证据上传中')
  })
  dataset = applyEvidenceUploadResult(dataset, batchId, ev2.id, true, '', clock, createIdFactory(41))
  dataset = applyEvidenceUploadResult(dataset, batchId, ev1.id, false, '再次超时', clock, createIdFactory(42))
  check('继续重试：失败证据保留，批次仍挂起', () => {
    const stored = dataset.offlineBatches[0].evidence.find((e) => e.id === ev1.id)
    assert.equal(stored?.attempts, 2)
    assert.equal(reconcileBatch(dataset, batchId, clock, createIdFactory(50)), dataset)
  })
  dataset = applyEvidenceUploadResult(dataset, batchId, ev1.id, true, '', clock, createIdFactory(43))
  dataset = reconcileBatch(dataset, batchId, clock, createIdFactory(50))
  check('恢复后上传成功并完成对账；每条证据恰好一条审计', () => {
    const stored = dataset.offlineBatches[0].evidence.find((e) => e.id === ev1.id)
    assert.equal(stored?.uploadState, '已上传')
    assert.equal(dataset.audit.filter((a) => a.action === '现场证据上传').length, 2)
    assert.equal(dataset.offlineBatches[0].status, '已对账')
  })
  check('对已上传证据重复应用成功结果不重复计数；再次对账不新增审计', () => {
    const auditBefore = dataset.audit.length
    let replayed = applyEvidenceUploadResult(dataset, batchId, ev1.id, true, '', clock, createIdFactory(60))
    replayed = reconcileBatch(replayed, batchId, clock, createIdFactory(61))
    assert.equal(replayed.audit.length, auditBefore)
    assert.equal(replayed.audit.filter((a) => a.action === '现场证据上传').length, 2)
  })
}

console.log('6. 总览/详情/导出共用同一批次、阈值版本与对账状态')
{
  let { dataset, batchId } = buildOfflineBatch()
  dataset = addRemeasure(dataset, batchId, { pointId: 'P-D02', baseReadingId: 'RD-5', value: 9.8 }, clock, createIdFactory(10))
  dataset = addEvidence(dataset, batchId, { kind: '照片', name: 'd02.jpg' }, clock, createIdFactory(20))
  dataset = markBatchSyncing(dataset, batchId)
  const ev = dataset.offlineBatches[0].evidence[0].id
  dataset = applyEvidenceUploadResult(dataset, batchId, ev, true, '', clock, createIdFactory(40))
  dataset = reconcileBatch(dataset, batchId, clock, createIdFactory(50))
  const view = batchConsistencyView(dataset.offlineBatches[0])
  const exported = JSON.parse(JSON.stringify({ batches: dataset.offlineBatches, thresholds: dataset.thresholds }))
  check('一致性视图与导出包、阈值表版本一致', () => {
    assert.equal(view.batchId, batchId)
    assert.equal(view.status, '已对账')
    assert.equal(view.evidenceUploaded, 1)
    assert.equal(view.evidenceTotal, 1)
    const tdVersion = exported.thresholds.find((t: { id: string }) => t.id === 'T-D').version
    assert.equal(view.thresholdText, `T-D V${tdVersion}、T-W V3、T-S V5、T-R V2`)
    assert.equal(exported.batches[0].status, view.status)
    assert.equal(exported.batches[0].report.thresholdVersions.find((s: { thresholdId: string }) => s.thresholdId === 'T-D').version, tdVersion)
  })
}

console.log(`\n全部 ${passed} 项断言通过`)
