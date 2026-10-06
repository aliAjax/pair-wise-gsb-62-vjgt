import type {
  Anomaly,
  AuditEntry,
  FieldEvidence,
  OfflineBatch,
  PointStatus,
  RawReading,
  ReconcileLine,
  Severity,
  TailingsDataset,
  Threshold
} from './models'

/**
 * 离线巡检批次的对账与合并引擎（纯函数）。
 *
 * 三个关键不变量：
 * 1. 中心正式读数（含中心修订）永远不会被迟到的离线副本覆盖；
 *    两端分别修改同次读数时，双方值都保留在对账行中，状态为“冲突待核对”。
 * 2. 阈值版本变化后，相关异常先失效再按新版本重算，已关闭的异常也要重新打开。
 * 3. 所有审计记录带幂等键，提交重放（断点续传、再次合并）不会多出审计记录。
 */

const clone = <T>(value: T): T => structuredClone(value)

const officialValueOf = (dataset: TailingsDataset, reading: RawReading): number =>
  dataset.officialRevisions.find((item) => item.readingId === reading.id)?.value ?? reading.value

const pointThreshold = (dataset: TailingsDataset, pointId: string): Threshold | undefined => {
  const point = dataset.points.find((item) => item.id === pointId)
  return dataset.thresholds.find((item) => item.id === point?.thresholdId)
}

export const evaluateStatus = (value: number, threshold: Threshold | undefined): PointStatus => {
  if (!threshold || !threshold.enabled) return '正常'
  if (value >= threshold.alarm) return '异常'
  if (value >= threshold.warning) return '预警'
  return '正常'
}

const evaluateSeverity = (value: number, threshold: Threshold | undefined): Severity | null => {
  if (!threshold || !threshold.enabled) return null
  if (value >= threshold.alarm) return '重大'
  if (value >= threshold.warning) return '较高'
  return null
}

/** 追加一条带幂等键的审计；重放时同键只保留一条 */
const appendAudit = (
  dataset: TailingsDataset,
  entry: Omit<AuditEntry, 'id'> & { idempotencyKey: string }
): AuditEntry | null => {
  const existed = dataset.audit.find((item) => item.idempotencyKey === entry.idempotencyKey)
  if (existed) return null
  const audit: AuditEntry = { ...entry, id: `AUD-${entry.idempotencyKey.replace(/[^a-zA-Z0-9-]/g, '_')}` }
  dataset.audit.unshift(audit)
  return audit
}

/**
 * 第一步：中心对账。
 * 逐行比较离线复测值与中心正式值，不修改任何正式读数，只产出对账行。
 */
export function reconcileBatch(datasetInput: TailingsDataset, batchId: string, now: string, operator = '对账服务'): TailingsDataset {
  const dataset = clone(datasetInput)
  const batch = dataset.offlineBatches.find((item) => item.id === batchId)
  if (!batch || batch.reconcileStatus === '已对账' || batch.reconcileStatus === '已合并') return dataset

  const lines: ReconcileLine[] = batch.readings.map((remeasure): ReconcileLine => {
    const base: ReconcileLine = {
      remeasureId: remeasure.id,
      readingId: remeasure.readingId,
      pointId: remeasure.pointId,
      offlineValue: remeasure.value,
      officialValue: null,
      unit: remeasure.unit,
      status: '新增读数',
      note: ''
    }
    if (!remeasure.readingId) {
      return { ...base, note: '中心无同次读数，离线新增，待合并入库' }
    }
    const officialReading = dataset.readings.find((item) => item.id === remeasure.readingId)
    if (!officialReading) {
      return { ...base, status: '新增读数', note: '中心读数不存在，按新增读数处理' }
    }
    const officialValue = officialValueOf(dataset, officialReading)
    const centerModified =
      officialReading.source === '中心修订' || dataset.officialRevisions.some((item) => item.readingId === officialReading.id)
    if (Number(officialValue) === Number(remeasure.value)) {
      return { ...base, officialValue, status: '一致', note: '两端读数一致' }
    }
    if (centerModified) {
      // 同一测点同次读数，两端分别修改：中心正式值不动，双方值都保留待核对
      return {
        ...base,
        officialValue,
        status: '冲突待核对',
        note: `中心正式读数${officialValue}${remeasure.unit}（V${officialReading.revision}）与离线复测${remeasure.value}${remeasure.unit}不一致，保留双方值待人工核对，中心值不覆盖`
      }
    }
    return {
      ...base,
      officialValue,
      status: '中心值生效',
      note: `离线复测${remeasure.value}${remeasure.unit}与中心${officialValue}${remeasure.unit}不一致，以中心正式值为准，离线值留档`
    }
  })

  batch.reconcileLines = lines
  batch.reconcileStatus = lines.some((line) => line.status === '冲突待核对') ? '待核对' : '已对账'
  batch.commitStage = '对账完成'
  batch.reconciledAt = now

  appendAudit(dataset, {
    entityId: batch.id,
    action: '离线批次对账',
    operator,
    detail:
      batch.reconcileStatus === '待核对'
        ? `对账完成：${lines.filter((line) => line.status === '冲突待核对').length}条两端同时修改的读数保留双方值待核对，中心正式读数未覆盖`
        : '对账完成：无两端同时修改冲突',
    createdAt: now,
    batchId: batch.id,
    thresholdVersion: 0,
    idempotencyKey: `batch:reconcile:${batch.id}`
  })
  for (const line of lines.filter((item) => item.status === '冲突待核对')) {
    appendAudit(dataset, {
      entityId: line.pointId,
      action: '读数冲突待核对',
      operator,
      detail: line.note,
      createdAt: now,
      batchId: batch.id,
      thresholdVersion: 0,
      idempotencyKey: `batch:conflict:${batch.id}:${line.readingId}`
    })
  }
  return dataset
}

/** 按当前阈值重算受影响测点的异常；已关闭异常在新版本下仍触发时重新打开 */
export function recomputeAnomalies(
  datasetInput: TailingsDataset,
  options: { thresholdIds?: string[]; batchId?: string; now: string; operator?: string }
): TailingsDataset {
  const dataset = clone(datasetInput)
  const { now, batchId = '', operator = '阈值引擎' } = options
  const thresholdIds = options.thresholdIds ?? dataset.thresholds.map((item) => item.id)

  for (const anomaly of dataset.anomalies) {
    const point = dataset.points.find((item) => item.id === anomaly.pointId)
    const threshold = dataset.thresholds.find((item) => item.id === point?.thresholdId)
    if (!point || !threshold || !thresholdIds.includes(threshold.id)) continue
    if (anomaly.thresholdVersion >= threshold.version) continue

    const triggerReading = dataset.readings.find((item) => item.id === anomaly.triggerReadingId)
    const observed = triggerReading ? officialValueOf(dataset, triggerReading) : Number.parseFloat(anomaly.observedValue)
    const severity = evaluateSeverity(observed, threshold)
    const fromVersion = anomaly.thresholdVersion

    appendAudit(dataset, {
      entityId: anomaly.id,
      action: '异常失效重算',
      operator,
      detail: `阈值${threshold.id}由V${fromVersion}变更为V${threshold.version}，异常按新阈值重新判定`,
      createdAt: now,
      batchId,
      thresholdVersion: threshold.version,
      idempotencyKey: `threshold:invalidate:${anomaly.id}:v${threshold.version}`
    })

    anomaly.thresholdVersion = threshold.version
    anomaly.version += 1

    if (severity) {
      anomaly.severity = severity
      if (anomaly.status === '已关闭' || anomaly.status === '重算失效') {
        // 异常处置已关闭（或此前重算失效），但新版本下再次触发：必须重新打开
        const wasClosed = anomaly.status === '已关闭'
        anomaly.status = '原因调查中'
        anomaly.closedAt = ''
        anomaly.recomputeState = '重算重开'
        anomaly.reopenedByBatchId = batchId
        appendAudit(dataset, {
          entityId: anomaly.id,
          action: wasClosed ? '已关闭异常重新打开' : '失效异常按新阈值重开',
          operator,
          detail: `阈值V${threshold.version}下观测值${observed}${threshold.unit}仍超${severity === '重大' ? '报警' : '预警'}阈值，${wasClosed ? '原关闭处置撤销，' : ''}重新进入原因调查`,
          createdAt: now,
          batchId,
          thresholdVersion: threshold.version,
          idempotencyKey: `threshold:reopen:${anomaly.id}:v${threshold.version}`
        })
      } else {
        anomaly.recomputeState = '生效中'
      }
    } else {
      // 新版本下不再越限：异常失效（不按普通关闭处理，保留处置历史）
      anomaly.recomputeState = '重算失效'
      anomaly.status = '重算失效'
      anomaly.closedAt = now
      appendAudit(dataset, {
        entityId: anomaly.id,
        action: '异常重算后失效关闭',
        operator,
        detail: `阈值V${threshold.version}下观测值${observed}${threshold.unit}不再越限，异常失效并自动关闭`,
        createdAt: now,
        batchId,
        thresholdVersion: threshold.version,
        idempotencyKey: `threshold:resolve:${anomaly.id}:v${threshold.version}`
      })
    }
  }
  return dataset
}

/** 中心调整阈值：版本+1，相关异常标记失效，随后立即按新版本重算 */
export function bumpThreshold(
  datasetInput: TailingsDataset,
  thresholdId: string,
  patch: Partial<Pick<Threshold, 'warning' | 'alarm' | 'changeRate' | 'enabled'>>,
  operator: string,
  now: string
): TailingsDataset {
  let dataset = clone(datasetInput)
  const threshold = dataset.thresholds.find((item) => item.id === thresholdId)
  if (!threshold) return dataset
  const nextVersion = threshold.version + 1
  Object.assign(threshold, patch, { version: nextVersion })

  const affected = dataset.anomalies.filter((anomaly) => {
    const point = dataset.points.find((item) => item.id === anomaly.pointId)
    return point?.thresholdId === thresholdId
  })
  for (const anomaly of affected) {
    anomaly.recomputeState = '已失效待重算'
  }
  appendAudit(dataset, {
    entityId: thresholdId,
    action: '阈值版本变更',
    operator,
    detail: `阈值${threshold.type}调整为预警${threshold.warning}、报警${threshold.alarm}${threshold.unit}，版本V${threshold.version - 1}→V${threshold.version}，${affected.length}条相关异常失效待重算`,
    createdAt: now,
    batchId: '',
    thresholdVersion: threshold.version,
    idempotencyKey: `threshold:bump:${thresholdId}:v${threshold.version}`
  })
  dataset = recomputeAnomalies(dataset, { thresholdIds: [thresholdId], now, operator })
  return dataset
}

const archiveEvidence = (dataset: TailingsDataset, batch: OfflineBatch, now: string): void => {
  for (const evidence of batch.evidence) {
    appendAudit(dataset, {
      entityId: batch.id,
      action: '现场证据归档',
      operator: batch.inspector,
      detail: `${evidence.kind} ${evidence.filename}（${evidence.bytes}字节，摘要${evidence.digest}）随离线批次归档，断点续传后未重复登记`,
      createdAt: now,
      batchId: batch.id,
      thresholdVersion: 0,
      idempotencyKey: `batch:evidence:${batch.id}:${evidence.id}`
    })
  }
}

/**
 * 第二步：合并入库（幂等）。
 * 已合并批次再次提交不会重复插入读数或审计；冲突读数只保留双方值，不覆盖中心正式值。
 */
export function mergeBatch(datasetInput: TailingsDataset, batchId: string, now: string, operator = '对账服务'): TailingsDataset {
  const dataset = clone(datasetInput)
  const batch = dataset.offlineBatches.find((item) => item.id === batchId)
  if (!batch || !batch.reconcileLines.length ||
      batch.reconcileStatus === '未对账' ||
      batch.commitStage === '待提交' || batch.commitStage === '证据上传中' || batch.commitStage === '待对账') {
    return dataset
  }
  if (batch.reconcileStatus === '已合并' || batch.mergedAt) return dataset // 重放保护

  // 1. 新增读数入库；冲突/中心值生效的读数一律不覆盖中心正式值
  for (const line of batch.reconcileLines) {
    if (line.status !== '新增读数' || line.offlineValue === null) continue
    const remeasure = batch.readings.find((item) => item.id === line.remeasureId)
    const newId = line.readingId || `RD-OFF-${batch.id}-${line.pointId}`
    if (dataset.readings.some((item) => item.id === newId)) continue // 重放：已入库不重复追加
    const reading: RawReading = {
      id: newId,
      pointId: line.pointId,
      value: line.offlineValue,
      unit: line.unit,
      capturedAt: remeasure?.measuredAt ?? batch.recordedAt,
      deviceId: `OFFLINE-${batch.inspector}`,
      quality: '有效',
      revision: 0,
      source: '离线批次',
      batchId: batch.id
    }
    dataset.readings.unshift(reading)
    appendAudit(dataset, {
      entityId: reading.pointId,
      action: '离线读数入库',
      operator: batch.inspector,
      detail: `新增离线复测读数${reading.value}${reading.unit}（${batch.id}），原始读数只追加不修改`,
      createdAt: now,
      batchId: batch.id,
      thresholdVersion: pointThreshold(dataset, reading.pointId)?.version ?? 0,
      idempotencyKey: `batch:new-reading:${batch.id}:${reading.id}`
    })
  }

  // 2. 测点当前值与状态仅对新增读数的测点重算；冲突行保留中心正式值，不触碰中心测点
  const touchedPoints = new Set(
    batch.reconcileLines.filter((line) => line.status === '新增读数').map((line) => line.pointId)
  )
  for (const pointId of touchedPoints) {
    const point = dataset.points.find((item) => item.id === pointId)
    if (!point) continue
    const latest = dataset.readings
      .filter((item) => item.pointId === point.id)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0]
    if (latest) {
      point.currentValue = officialValueOf(dataset, latest)
      point.lastInspectionAt = latest.capturedAt
      point.status = evaluateStatus(point.currentValue, pointThreshold(dataset, point.id))
    }
  }

  // 3. 阈值版本：离场后中心版本变化的相关异常失效重算，已关闭的也会重开
  const staleThresholdIds = new Set<string>()
  for (const [thresholdId, baseVersion] of Object.entries(batch.thresholdBaseline)) {
    const current = dataset.thresholds.find((item) => item.id === thresholdId)
    if (current && current.version > baseVersion) staleThresholdIds.add(thresholdId)
  }
  if (staleThresholdIds.size) {
    const recomputed = recomputeAnomalies(dataset, { thresholdIds: [...staleThresholdIds], batchId: batch.id, now, operator })
    dataset.anomalies = recomputed.anomalies
    dataset.audit = recomputed.audit
  }

  // 4. 新增读数若在当前阈值下越限，生成新异常
  for (const line of batch.reconcileLines) {
    if (line.status !== '新增读数' || line.offlineValue === null) continue
    const threshold = pointThreshold(dataset, line.pointId)
    const severity = evaluateSeverity(line.offlineValue, threshold)
    const hasOpenAnomaly = dataset.anomalies.some(
      (item) => item.pointId === line.pointId && item.status !== '已关闭' && item.status !== '重算失效'
    )
    if (severity && !hasOpenAnomaly) {
      const readingId = `RD-OFF-${batch.id}-${line.pointId}`
      const anomaly: Anomaly = {
        id: `AN-OFF-${batch.id}-${line.pointId}`,
        pointId: line.pointId,
        title: `离线复测${line.pointId}数值超${severity === '重大' ? '报警' : '预警'}阈值`,
        severity,
        status: '待现场复核',
        openedAt: now,
        owner: '待分派',
        triggerReadingId: readingId,
        observedValue: `${line.offlineValue} ${line.unit}（离线批次${batch.id}）`,
        fieldReviews: [],
        opinions: [],
        plan: {
          id: `PL-OFF-${batch.id}-${line.pointId}`,
          action: '加密监测',
          owner: '',
          deadline: '',
          conditions: '离线复测触发，待现场复核确认后提交处置方案。',
          emergencyLinked: false,
          approvedBy: '',
          approvedAt: ''
        },
        closedAt: '',
        version: 1,
        thresholdId: threshold?.id ?? '',
        thresholdVersion: threshold?.version ?? 0,
        recomputeState: '生效中',
        firstOpenedAt: now,
        reopenedByBatchId: ''
      }
      dataset.anomalies.unshift(anomaly)
      appendAudit(dataset, {
        entityId: anomaly.id,
        action: '生成异常',
        operator: '阈值引擎',
        detail: `离线复测${line.offlineValue}${line.unit}超${severity === '重大' ? `报警阈值${threshold?.alarm}` : `预警阈值${threshold?.warning}`}（阈值V${threshold?.version}）`,
        createdAt: now,
        batchId: batch.id,
        thresholdVersion: threshold?.version ?? 0,
        idempotencyKey: `batch:new-anomaly:${batch.id}:${anomaly.id}`
      })
    }
  }

  // 5. 证据归档（逐条幂等，续传重放不重复）
  archiveEvidence(dataset, batch, now)

  // 6. 批次落账
  batch.reconcileStatus = '已合并'
  batch.commitStage = '已合并'
  batch.mergedAt = now
  batch.mergedThresholdVersions = Object.fromEntries(dataset.thresholds.map((item) => [item.id, item.version]))
  batch.lastError = ''
  appendAudit(dataset, {
    entityId: batch.id,
    action: '离线批次合并入库',
    operator,
    detail: `批次纳入${batch.readings.length}条复测、${batch.evidence.length}份证据；阈值版本${[...staleThresholdIds].join('、') || '无变化'}；冲突读数只保留双方值，中心正式读数未覆盖`,
    createdAt: now,
    batchId: batch.id,
    thresholdVersion: 0,
    idempotencyKey: `batch:merge:${batch.id}`
  })
  return dataset
}

/** 证据尝试一次上传（在内存/本地持久化的副本上推进检查点） */
export function markEvidenceAttempt(batchInput: OfflineBatch, evidenceId: string, outcome: { ok: boolean; error?: string }): OfflineBatch {
  const batch = clone(batchInput)
  const evidence = batch.evidence.find((item): item is FieldEvidence => item.id === evidenceId)
  if (!evidence || evidence.state === '已上传') return batch
  evidence.attempts += 1
  if (outcome.ok) {
    evidence.state = '已上传'
    evidence.lastError = ''
  } else {
    evidence.state = '失败待重试'
    evidence.lastError = outcome.error ?? '上传失败'
    batch.commitStage = '失败待恢复'
    batch.lastError = evidence.lastError
  }
  if (batch.evidence.every((item) => item.state === '已上传')) {
    batch.commitStage = '待对账'
    batch.lastError = ''
  } else if (batch.commitStage === '待提交') {
    batch.commitStage = '证据上传中'
  }
  return batch
}

/** 应用启动/刷新后恢复：上传中断的证据回到“失败待重试”，批次可继续提交 */
export function recoverBatchStage(batchInput: OfflineBatch): OfflineBatch {
  const batch = clone(batchInput)
  let touched = false
  for (const evidence of batch.evidence) {
    if (evidence.state === '上传中') {
      evidence.state = '失败待重试'
      evidence.lastError = evidence.lastError || '网络中断，现场证据待恢复续传'
      touched = true
    }
  }
  if ((batch.commitStage === '证据上传中' || batch.commitStage === '待提交') && batch.evidence.some((item) => item.state !== '已上传')) {
    batch.commitStage = '失败待恢复'
    batch.lastError = batch.lastError || '上传中断，已恢复现场证据检查点，可继续重试'
  }
  return touched || batch.commitStage === '失败待恢复' ? batch : batch
}
