import type {
  Anomaly,
  AnomalyRecalcState,
  AuditEntry,
  BatchThresholdSnapshot,
  EvidenceKind,
  OfflineBatch,
  OfflineEvidence,
  OfflineRemeasure,
  PointStatus,
  RawReading,
  ReadingConflict,
  Severity,
  TailingsDataset,
  Threshold
} from './models'
import { nowIso } from './models'

/**
 * 离线巡检批次对账引擎（纯函数、可恢复、可重放）。
 *
 * 不变量：
 * 1. 原始读数只读：离线复测与中心修订都以“新版本读数”并入，绝不就地覆盖同一次读数。
 * 2. 同一测点同次读数两端分别修改：中心正式读数生效，迟到离线副本只作为待核对双值保留。
 * 3. 阈值版本变化后，相关异常按新阈值失效重算；已关闭的异常也会重新打开。
 * 4. 证据上传失败可恢复重试；所有审计事件带幂等键，重放不产生重复审计。
 */

export interface RemeasureInput {
  pointId: string
  baseReadingId: string
  value: number
  measuredAt?: string
  note?: string
}

export interface EvidenceInput {
  kind: EvidenceKind
  name: string
  note?: string
  sizeBytes?: number
}

export interface IdFactory {
  next: (prefix: string) => string
}

export const createIdFactory = (seedStart = 100): IdFactory => {
  let seed = seedStart
  return { next: (prefix: string) => `${prefix}-${seed++}` }
}

const audit = (entry: AuditEntry, log: AuditEntry[]): void => {
  if (entry.idemKey && log.some((item) => item.idemKey === entry.idemKey)) return
  log.unshift(entry)
}

const snapshotThresholds = (thresholds: Threshold[]): BatchThresholdSnapshot[] =>
  thresholds.map((item) => ({ thresholdId: item.id, version: item.version }))

/** 断网开始：建立离线巡检批次，并冻结当时的阈值版本快照。 */
export const createOfflineBatch = (
  dataset: TailingsDataset,
  inspector: string,
  zone: string,
  clock: () => string = nowIso,
  ids: IdFactory = createIdFactory()
): { dataset: TailingsDataset; batch: OfflineBatch } => {
  const next = structuredClone(dataset)
  const at = clock()
  const batch: OfflineBatch = {
    id: ids.next('OB'),
    inspector: inspector || '现场巡检员',
    zone: zone || '山谷现场',
    createdAt: at,
    offlineSince: at,
    status: '离线编辑中',
    remeasures: [],
    evidence: [],
    thresholdSnapshot: snapshotThresholds(next.thresholds),
    report: null
  }
  next.offlineBatches.unshift(batch)
  audit(
    { id: ids.next('AUD'), entityId: batch.id, action: '建立离线巡检批次', operator: batch.inspector, detail: `${batch.zone}断网登记，阈值快照 ${batch.thresholdSnapshot.map((s) => `${s.thresholdId} V${s.version}`).join('、')}`, createdAt: at, idemKey: `batch-create:${batch.id}`, batchId: batch.id },
    next.audit
  )
  return { dataset: next, batch }
}

const getBatch = (dataset: TailingsDataset, batchId: string): OfflineBatch | undefined =>
  dataset.offlineBatches.find((item) => item.id === batchId)

/** 断网期间登记测点复测值（可针对同一次原始读数复测多次）。 */
export const addRemeasure = (
  dataset: TailingsDataset,
  batchId: string,
  input: RemeasureInput,
  clock: () => string = nowIso,
  ids: IdFactory = createIdFactory()
): TailingsDataset => {
  const next = structuredClone(dataset)
  const batch = getBatch(next, batchId)
  const base = next.readings.find((item) => item.id === input.baseReadingId && item.pointId === input.pointId)
  if (!batch || batch.status !== '离线编辑中' || !base || Number.isNaN(input.value)) return dataset
  const at = input.measuredAt ?? clock()
  const remeasure: OfflineRemeasure = {
    id: ids.next('RM'),
    pointId: input.pointId,
    baseReadingId: input.baseReadingId,
    value: input.value,
    unit: base.unit,
    measuredAt: at,
    note: input.note ?? '',
    mergedReadingId: ''
  }
  batch.remeasures.push(remeasure)
  audit(
    { id: ids.next('AUD'), entityId: batch.id, action: '离线登记复测', operator: batch.inspector, detail: `${input.pointId} 复测 ${input.value} ${base.unit}（待对账）`, createdAt: at, idemKey: `remeasure:${remeasure.id}`, batchId: batch.id },
    next.audit
  )
  return next
}

/** 断网期间采集现场证据（照片/视频/录音/文档），先离线留存待恢复后上传。 */
export const addEvidence = (
  dataset: TailingsDataset,
  batchId: string,
  input: EvidenceInput,
  clock: () => string = nowIso,
  ids: IdFactory = createIdFactory()
): TailingsDataset => {
  const next = structuredClone(dataset)
  const batch = getBatch(next, batchId)
  if (!batch || batch.status !== '离线编辑中' || !input.name) return dataset
  const evidence: OfflineEvidence = {
    id: ids.next('EV'),
    kind: input.kind,
    name: input.name,
    note: input.note ?? '',
    capturedAt: clock(),
    sizeBytes: input.sizeBytes ?? Math.round(800 + input.name.length * 137),
    uploadState: '待上传',
    uploadedAt: '',
    failReason: '',
    attempts: 0
  }
  batch.evidence.push(evidence)
  audit(
    { id: ids.next('AUD'), entityId: batch.id, action: '离线留存现场证据', operator: batch.inspector, detail: `${input.kind}《${input.name}》待网络恢复上传`, createdAt: evidence.capturedAt, idemKey: `evidence-capture:${evidence.id}`, batchId: batch.id },
    next.audit
  )
  return next
}

/** 网络恢复：批次进入证据上传/对账阶段（幂等）。 */
export const markBatchSyncing = (dataset: TailingsDataset, batchId: string): TailingsDataset => {
  const next = structuredClone(dataset)
  const batch = getBatch(next, batchId)
  if (!batch || batch.status !== '离线编辑中') return dataset
  batch.status = '证据上传中'
  return next
}

/**
 * 单次证据上传结果（来自不稳定的现场网络网关）。
 * 成功：已上传证据幂等跳过；失败：保留现场证据并记录原因，等待继续重试。
 */
export const applyEvidenceUploadResult = (
  dataset: TailingsDataset,
  batchId: string,
  evidenceId: string,
  success: boolean,
  failReason: string,
  clock: () => string = nowIso,
  ids: IdFactory = createIdFactory()
): TailingsDataset => {
  const next = structuredClone(dataset)
  const batch = getBatch(next, batchId)
  const evidence = batch?.evidence.find((item) => item.id === evidenceId)
  if (!batch || !evidence) return dataset
  if (evidence.uploadState === '已上传') return next
  evidence.attempts += 1
  if (success) {
    evidence.uploadState = '已上传'
    evidence.uploadedAt = clock()
    evidence.failReason = ''
    audit(
      { id: ids.next('AUD'), entityId: batch.id, action: '现场证据上传', operator: batch.inspector, detail: `${evidence.kind}《${evidence.name}》上传成功（第${evidence.attempts}次尝试）`, createdAt: evidence.uploadedAt, idemKey: `evidence-upload:${evidence.id}`, batchId: batch.id },
      next.audit
    )
  } else {
    evidence.uploadState = '上传失败'
    evidence.failReason = failReason || '网络中断'
  }
  return next
}

export const batchHasPendingEvidence = (batch: OfflineBatch): boolean =>
  batch.evidence.some((item) => item.uploadState !== '已上传')

/** 断网期间中心发布阈值新版本：版本号递增并留痕（重算在对账时按批次快照统一执行）。 */
export const publishThreshold = (
  dataset: TailingsDataset,
  thresholdId: string,
  patch: Partial<Pick<Threshold, 'warning' | 'alarm' | 'changeRate' | 'enabled'>>,
  operator: string,
  clock: () => string = nowIso,
  ids: IdFactory = createIdFactory()
): TailingsDataset => {
  const next = structuredClone(dataset)
  const threshold = next.thresholds.find((item) => item.id === thresholdId)
  if (!threshold) return dataset
  const previous = threshold.version
  Object.assign(threshold, patch, { version: previous + 1, updatedAt: clock() })
  audit(
    { id: ids.next('AUD'), entityId: thresholdId, action: '发布阈值新版本', operator, detail: `V${previous} → V${threshold.version}，预警${threshold.warning} / 报警${threshold.alarm} ${threshold.unit}`, createdAt: threshold.updatedAt, idemKey: `threshold:${thresholdId}:V${threshold.version}` },
    next.audit
  )
  return next
}

/** 断网期间中心对同一次正式读数作出修订（保留原读数，新增中心修订版本）。 */
export const reviseCenterReading = (
  dataset: TailingsDataset,
  baseReadingId: string,
  value: number,
  operator: string,
  clock: () => string = nowIso,
  ids: IdFactory = createIdFactory()
): TailingsDataset => {
  const next = structuredClone(dataset)
  const base = next.readings.find((item) => item.id === baseReadingId)
  if (!base) return dataset
  const at = clock()
  const revision: RawReading = {
    ...structuredClone(base),
    id: ids.next('RD'),
    value,
    origin: '中心修订',
    baseReadingId: base.id,
    quality: '有效',
    capturedAt: at
  }
  next.readings.unshift(revision)
  audit(
    { id: ids.next('AUD'), entityId: base.pointId, action: '中心修订正式读数', operator, detail: `${base.id} 正式值修订为 ${value} ${base.unit}，原读数保留`, createdAt: at, idemKey: `center-revision:${revision.id}` },
    next.audit
  )
  return next
}

/** 某“同次读数”当前在中心生效的正式值（中心修订优先，且只读不删原读数）。 */
const officialReadingOf = (readings: RawReading[], pointId: string, baseReadingId: string): RawReading => {
  const family = readings.filter((item) => item.pointId === pointId && (item.id === baseReadingId || item.baseReadingId === baseReadingId))
  const revisions = family.filter((item) => item.origin === '中心修订')
  if (revisions.length) return revisions.reduce((latest, item) => (item.capturedAt > latest.capturedAt ? item : latest), revisions[0])
  return family.find((item) => item.id === baseReadingId) ?? readings.find((item) => item.id === baseReadingId)!
}

/** 测点最新生效读数：冲突待核对的迟到离线副本不参与正式评估。 */
export const latestEffectiveReading = (readings: RawReading[], pointId: string): RawReading | undefined =>
  readings
    .filter((item) => item.pointId === pointId && item.reconcileState !== '冲突待核对')
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0]

const classifyPoint = (threshold: Threshold | undefined, value: number): PointStatus => {
  if (!threshold || !threshold.enabled) return '正常'
  if (value >= threshold.alarm) return '异常'
  if (value >= threshold.warning) return '预警'
  return '正常'
}

const severityOf = (threshold: Threshold, value: number): Severity => {
  if (value >= threshold.alarm * 1.1) return '重大'
  if (value >= threshold.alarm) return '较高'
  return '关注'
}

/**
 * 对账合并：把离线复测并入原始读数；冲突双值保留；按新阈值版本失效重算相关异常。
 * 已对账批次重放为幂等 no-op，审计不重复、证据不重复、异常不重复。
 */
export const reconcileBatch = (
  dataset: TailingsDataset,
  batchId: string,
  clock: () => string = nowIso,
  ids: IdFactory = createIdFactory()
): TailingsDataset => {
  const batch = dataset.offlineBatches.find((item) => item.id === batchId)
  if (!batch) return dataset
  // 可恢复：只有全部证据上传成功才提交对账；已对账批次重放直接返回同一结果。
  if (batch.status === '已对账' || batch.status === '已对账·待核对') return dataset
  if (batch.status !== '证据上传中' || batchHasPendingEvidence(batch)) return dataset

  const next = structuredClone(dataset)
  const target = getBatch(next, batchId)!
  const at = clock()
  const conflicts: ReadingConflict[] = next.conflicts
  let mergedCount = 0
  let conflictCount = 0

  // 1) 复测并入原始读数（原始读数不就地改写）
  for (const remeasure of target.remeasures) {
    const official = officialReadingOf(next.readings, remeasure.pointId, remeasure.baseReadingId)
    const centerChangedAfterOffline =
      official.origin === '中心修订' && official.capturedAt > target.offlineSince
    const diverged = official.value !== remeasure.value
    const merged: RawReading = {
      id: ids.next('RD'),
      pointId: remeasure.pointId,
      value: remeasure.value,
      unit: remeasure.unit,
      capturedAt: remeasure.measuredAt,
      deviceId: `离线复测/${target.inspector}`,
      quality: '有效',
      origin: '离线复测',
      batchId: target.id,
      baseReadingId: remeasure.baseReadingId,
      reconcileState: '已并入'
    }
    remeasure.mergedReadingId = merged.id

    if (centerChangedAfterOffline && diverged) {
      // 同一测点同次读数两端分别修改：中心正式读数不被覆盖，离线副本仅待核对
      merged.reconcileState = '冲突待核对'
      const key = `${remeasure.pointId}@${remeasure.baseReadingId}`
      const existing = conflicts.find((item) => item.readingKey === key && item.batchId === target.id)
      if (!existing) {
        const record: ReadingConflict = {
          id: ids.next('CF'),
          pointId: remeasure.pointId,
          baseReadingId: remeasure.baseReadingId,
          readingKey: key,
          officialValue: official.value,
          offlineValue: remeasure.value,
          unit: remeasure.unit,
          centerUpdatedAt: official.capturedAt,
          offlineMeasuredAt: remeasure.measuredAt,
          mergedReadingId: merged.id,
          status: '冲突待核对',
          batchId: target.id,
          resolvedNote: ''
        }
        conflicts.unshift(record)
        audit(
          { id: ids.next('AUD'), entityId: record.pointId, action: '读数冲突待核对', operator: '对账引擎', detail: `同次读数${remeasure.baseReadingId}：中心正式值 ${official.value} ${remeasure.unit} 已保留，迟到离线副本 ${remeasure.value} ${remeasure.unit} 待人工核对，正式读数未被覆盖`, createdAt: at, idemKey: `conflict:${record.id}`, batchId: target.id },
          next.audit
        )
      }
      conflictCount += 1
    } else {
      mergedCount += 1
      audit(
        { id: ids.next('AUD'), entityId: remeasure.pointId, action: '并入离线复测', operator: '对账引擎', detail: `${target.id} 复测 ${remeasure.value} ${remeasure.unit} 作为独立版本并入原始读数，原值保留`, createdAt: at, idemKey: `merge:${remeasure.id}`, batchId: target.id },
        next.audit
      )
    }
    next.readings.unshift(merged)
  }

  // 2) 阈值版本变化：找出批次快照之后升级的阈值，相关测点异常全部失效重算
  const recalculatedIds: string[] = []
  const openedIds: string[] = []
  const currentVersions = snapshotThresholds(next.thresholds)
  target.thresholdSnapshot = snapshotThresholds(next.thresholds)
  const changedThresholds = next.thresholds.filter((threshold) => {
    const old = batch.thresholdSnapshot.find((item) => item.thresholdId === threshold.id)
    return old && old.version !== threshold.version
  })

  for (const threshold of changedThresholds) {
    const pointIds = next.points.filter((point) => point.thresholdId === threshold.id).map((point) => point.id)
    for (const pointId of pointIds) {
      const point = next.points.find((item) => item.id === pointId)!
      const latest = latestEffectiveReading(next.readings, pointId)
      const value = latest?.value ?? point.currentValue
      const exceeds = threshold.enabled && value >= threshold.warning
      const pointStatus = classifyPoint(threshold, value)
      point.status = pointStatus
      if (latest && latest.capturedAt > point.lastInspectionAt) {
        point.currentValue = value
        point.lastInspectionAt = latest.capturedAt
      }

      const related = next.anomalies.filter((anomaly) => anomaly.pointId === pointId)
      if (related.length === 0 && exceeds && latest) {
        const created = createRecalculatedAnomaly(ids, pointId, threshold, value, latest.id, at)
        next.anomalies.unshift(created)
        openedIds.push(created.id)
        audit(
          { id: ids.next('AUD'), entityId: created.id, action: '阈值重算生成异常', operator: '阈值引擎', detail: `按${threshold.id} V${threshold.version}，最新值 ${value} ${threshold.unit} 达到${created.severity}级别`, createdAt: at, idemKey: `recalc-create:${created.id}`, batchId: target.id },
          next.audit
        )
        continue
      }

      for (const anomaly of related) {
        const wasClosed = anomaly.status === '已关闭'
        const recalc = evaluateAnomalyUnderThreshold(anomaly, threshold, value, exceeds, at)
        if (recalc.changed) {
          anomaly.status = recalc.status
          anomaly.closedAt = recalc.closedAt
          anomaly.recalcState = recalc.state
          anomaly.recalcNote = recalc.note
          anomaly.thresholdVersion = `${threshold.id} V${threshold.version}`
          anomaly.version += 1
          anomaly.recalcCount += 1
          recalculatedIds.push(anomaly.id)
          if (wasClosed && anomaly.status !== '已关闭') openedIds.push(anomaly.id)
          audit(
            { id: ids.next('AUD'), entityId: anomaly.id, action: '阈值版本变化重算', operator: '阈值引擎', detail: recalc.note, createdAt: at, idemKey: `recalc:${anomaly.id}:${threshold.id}V${threshold.version}`, batchId: target.id },
            next.audit
          )
        }
      }
    }
  }

  // 未升级阈值的测点：若并入的复测是最新值，也同步测点状态，但不触发异常重算
  for (const remeasure of target.remeasures) {
    const point = next.points.find((item) => item.id === remeasure.pointId)
    if (!point || changedThresholds.some((t) => t.id === point.thresholdId)) continue
    const latest = latestEffectiveReading(next.readings, point.id)
    if (!latest) continue
    const threshold = next.thresholds.find((item) => item.id === point.thresholdId)
    point.currentValue = latest.value
    point.status = classifyPoint(threshold, latest.value)
    point.lastInspectionAt = latest.capturedAt > point.lastInspectionAt ? latest.capturedAt : point.lastInspectionAt
  }

  target.report = {
    reconciledAt: at,
    remeasureCount: target.remeasures.length,
    evidenceCount: target.evidence.length,
    conflictCount,
    recalculatedAnomalyIds: recalculatedIds,
    openedAnomalyIds: openedIds,
    thresholdVersions: currentVersions,
    note:
      `并入复测 ${mergedCount} 条，冲突待核对 ${conflictCount} 条；` +
      `阈值升级 ${changedThresholds.length} 项，重算异常 ${recalculatedIds.length} 个${openedIds.length ? `，重开 ${openedIds.length} 个` : ''}`
  }
  target.status = conflictCount > 0 ? '已对账·待核对' : '已对账'

  audit(
    { id: ids.next('AUD'), entityId: target.id, action: '离线批次对账合并', operator: '对账引擎', detail: target.report.note, createdAt: at, idemKey: `reconcile:${target.id}`, batchId: target.id },
    next.audit
  )
  return next
}

const createRecalculatedAnomaly = (
  ids: IdFactory,
  pointId: string,
  threshold: Threshold,
  value: number,
  readingId: string,
  at: string
): Anomaly => ({
  id: ids.next('AN'),
  pointId,
  title: `${pointId} 按新阈值 V${threshold.version} 超限`,
  severity: severityOf(threshold, value),
  status: '待现场复核',
  openedAt: at,
  owner: '阈值引擎重算',
  triggerReadingId: readingId,
  observedValue: `${value} ${threshold.unit}（阈值 V${threshold.version}：预警 ${threshold.warning} / 报警 ${threshold.alarm}）`,
  fieldReviews: [],
  opinions: [],
  plan: { id: ids.next('PL'), action: '加密监测', owner: '', deadline: '', conditions: '', emergencyLinked: false, approvedBy: '', approvedAt: '' },
  closedAt: '',
  version: 1,
  thresholdVersion: `${threshold.id} V${threshold.version}`,
  recalcState: '按新阈值重开',
  recalcNote: `离线对账时按 ${threshold.id} V${threshold.version} 重算生成`,
  recalcCount: 1
})

interface RecalcResult {
  changed: boolean
  status: Anomaly['status']
  closedAt: string
  state: AnomalyRecalcState
  note: string
}

const evaluateAnomalyUnderThreshold = (
  anomaly: Anomaly,
  threshold: Threshold,
  value: number,
  exceeds: boolean,
  at: string
): RecalcResult => {
  const base = `${threshold.id} V${threshold.version} 下最新值 ${value} ${threshold.unit}`
  if (!exceeds) {
    // 新阈值下不再超限：异常失效；若处于开启状态则关闭并留痕
    if (anomaly.status === '已关闭') {
      return { changed: true, status: '已关闭', closedAt: anomaly.closedAt, state: '阈值失效·关闭', note: `${base} 低于预警值 ${threshold.warning}，异常按新阈值失效（保持关闭）` }
    }
    return { changed: true, status: '已关闭', closedAt: at, state: '阈值失效·关闭', note: `${base} 低于预警值 ${threshold.warning}，异常失效并自动关闭` }
  }
  if (value >= threshold.alarm) {
    // 仍达报警：已关闭的处置也必须重新打开
    const note = `${base} 仍达到/超过报警值 ${threshold.alarm}，异常失效后按新阈值重算重开`
    return { changed: true, status: '重算重开', closedAt: '', state: '阈值失效·重开', note }
  }
  const note = `${base} 处于预警区间（${threshold.warning}~${threshold.alarm}），按新阈值降级为待现场复核`
  return { changed: true, status: '待现场复核', closedAt: '', state: '阈值失效·重开', note }
}

/** 导出/总览/详情共用的对账一致性汇总（保证三处显示同一批次、阈值版本与状态）。 */
export const batchConsistencyView = (batch: OfflineBatch): {
  batchId: string
  status: OfflineBatch['status']
  thresholdText: string
  reportNote: string
  evidenceUploaded: number
  evidenceTotal: number
} => ({
  batchId: batch.id,
  status: batch.status,
  thresholdText: (batch.report?.thresholdVersions ?? batch.thresholdSnapshot).map((s) => `${s.thresholdId} V${s.version}`).join('、'),
  reportNote: batch.report?.note ?? '尚未对账',
  evidenceUploaded: batch.evidence.filter((item) => item.uploadState === '已上传').length,
  evidenceTotal: batch.evidence.length
})
