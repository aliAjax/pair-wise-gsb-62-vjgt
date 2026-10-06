import { createFeatureSelector, createSelector } from '@ngrx/store'
import { batchConsistencyView } from '../domain'
import type { TailingsState } from './tailings.reducer'

export const selectTailings = createFeatureSelector<TailingsState>('tailings')
export const selectDataset = createSelector(selectTailings, (state) => state.dataset)
export const selectPoints = createSelector(selectDataset, (dataset) => dataset.points)
export const selectReadings = createSelector(selectDataset, (dataset) => dataset.readings)
export const selectAnomalies = createSelector(selectDataset, (dataset) => dataset.anomalies)
export const selectOfflineBatches = createSelector(selectDataset, (dataset) => dataset.offlineBatches)
export const selectConflicts = createSelector(selectDataset, (dataset) => dataset.conflicts)
export const selectOnline = createSelector(selectTailings, (state) => state.online)
export const selectSyncMessage = createSelector(selectTailings, (state) => state.syncMessage)
export const selectSelectedAnomaly = createSelector(selectTailings, (state) => state.dataset.anomalies.find((item) => item.id === state.selectedAnomalyId) ?? state.dataset.anomalies[0])
export const selectFilteredAnomalies = createSelector(selectTailings, (state) => state.dataset.anomalies.filter((item) => {
  const point = state.dataset.points.find((value) => value.id === item.pointId)
  const text = `${item.id} ${item.title} ${item.owner} ${point?.name ?? ''}`.toLowerCase()
  return (!state.keyword || text.includes(state.keyword.toLowerCase())) && (state.status === '全部' || item.status === state.status)
}))

/** 总览、异常详情、审计、导出共用的对账一致性视图（同一批次/阈值版本/对账状态） */
export const selectBatchConsistency = createSelector(selectOfflineBatches, (batches) =>
  batches.map((batch) => ({ batch, view: batchConsistencyView(batch) }))
)
export const selectLatestBatch = createSelector(selectOfflineBatches, (batches) => batches[0])
