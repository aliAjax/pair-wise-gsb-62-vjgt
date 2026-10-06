import { createFeatureSelector, createSelector } from '@ngrx/store'
import type { OfflineBatch } from '../domain'
import type { TailingsState } from './tailings.reducer'

export const selectTailings = createFeatureSelector<TailingsState>('tailings')
export const selectDataset = createSelector(selectTailings, (state) => state.dataset)
export const selectPoints = createSelector(selectDataset, (dataset) => dataset.points)
export const selectAnomalies = createSelector(selectDataset, (dataset) => dataset.anomalies)
export const selectOfflineBatches = createSelector(selectDataset, (dataset) => dataset.offlineBatches)

export const selectSelectedAnomaly = createSelector(selectTailings, (state) =>
  state.dataset.anomalies.find((item) => item.id === state.selectedAnomalyId) ?? state.dataset.anomalies[0]
)

export const selectFilteredAnomalies = createSelector(selectTailings, (state) => state.dataset.anomalies.filter((item) => {
  const point = state.dataset.points.find((value) => value.id === item.pointId)
  const text = `${item.id} ${item.title} ${item.owner} ${point?.name ?? ''}`.toLowerCase()
  return (!state.keyword || text.includes(state.keyword.toLowerCase())) && (state.status === '全部' || item.status === state.status)
}))

export const selectBatchById = (batchId: string) =>
  createSelector(selectDataset, (dataset) => dataset.offlineBatches.find((item) => item.id === batchId))

/** 总览页、异常详情和导出共用的批次/阈值/对账摘要，保证三处口径一致 */
export const selectBatchSummary = createSelector(selectDataset, (dataset) => {
  const thresholdVersionMap = Object.fromEntries(dataset.thresholds.map((item) => [`${item.id}`, item.version]))
  return dataset.offlineBatches.map((batch: OfflineBatch) => {
    const evidenceTotal = batch.evidence.length
    const evidenceUploaded = batch.evidence.filter((item) => item.state === '已上传').length
    const evidenceFailed = batch.evidence.filter((item) => item.state === '失败待重试' || item.state === '待上传' || item.state === '上传中').length
    const lines = batch.reconcileLines
    const conflicts = lines.filter((line) => line.status === '冲突待核对').length
    const newReadings = lines.filter((line) => line.status === '新增读数').length
    const thresholdDelta = Object.entries(batch.thresholdBaseline)
      .map(([id, base]) => ({ id, base, current: thresholdVersionMap[id] ?? base }))
      .filter((item) => item.current > item.base)
    return {
      batch,
      reconcileStatus: batch.reconcileStatus,
      commitStage: batch.commitStage,
      evidenceTotal,
      evidenceUploaded,
      evidenceFailed,
      conflicts,
      newReadings,
      thresholdDelta,
      mergedThresholdVersions: batch.mergedThresholdVersions,
      mergedAt: batch.mergedAt
    }
  })
})

/** 导出审阅包：所有视图与导出共用同一快照 */
export const selectExportPackage = createSelector(selectDataset, (dataset) => ({
  exportedAt: new Date().toISOString(),
  thresholdVersions: Object.fromEntries(dataset.thresholds.map((item) => [item.id, { version: item.version, warning: item.warning, alarm: item.alarm, unit: item.unit }])),
  batches: dataset.offlineBatches.map((batch) => ({
    id: batch.id,
    inspector: batch.inspector,
    valley: batch.valley,
    recordedAt: batch.recordedAt,
    reconcileStatus: batch.reconcileStatus,
    commitStage: batch.commitStage,
    reconciledAt: batch.reconciledAt,
    mergedAt: batch.mergedAt,
    thresholdBaseline: batch.thresholdBaseline,
    mergedThresholdVersions: batch.mergedThresholdVersions,
    reconcileLines: batch.reconcileLines,
    evidence: batch.evidence.map((item) => ({ id: item.id, filename: item.filename, kind: item.kind, digest: item.digest, state: item.state, attempts: item.attempts })),
    readings: batch.readings
  })),
  points: dataset.points,
  thresholds: dataset.thresholds,
  readings: dataset.readings,
  officialRevisions: dataset.officialRevisions,
  anomalies: dataset.anomalies,
  audit: dataset.audit
}))
