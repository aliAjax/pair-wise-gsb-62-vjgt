import { createReducer, on, type MetaReducer } from '@ngrx/store'
import {
  addEvidence,
  addRemeasure,
  applyEvidenceUploadResult,
  createIdFactory,
  createOfflineBatch,
  markBatchSyncing,
  nowIso,
  publishThreshold,
  reconcileBatch,
  reviseCenterReading,
  type IdFactory
} from '../domain'
import type { Anomaly, AuditEntry, TailingsDataset } from '../domain'
import { seedDataset } from '../data/seed'
import { TailingsActions } from './tailings.actions'

export interface TailingsState {
  dataset: TailingsDataset
  loading: boolean
  error: string
  online: boolean
  syncMessage: string
  selectedAnomalyId: string
  keyword: string
  status: Anomaly['status'] | '全部'
}

const STORAGE_KEY = 'tailings-monitor-dataset-v2'

let idSeed = 50
const audit = (entityId: string, action: string, operator: string, detail: string): AuditEntry => ({
  id: `AUD-${Date.now()}-${idSeed++}`, entityId, action, operator, detail, createdAt: new Date().toISOString()
})

export const ids: IdFactory = createIdFactory(100)

export const initialTailingsState: TailingsState = {
  dataset: structuredClone(seedDataset),
  loading: false,
  error: '',
  online: true,
  syncMessage: '',
  selectedAnomalyId: seedDataset.anomalies[0]?.id ?? '',
  keyword: '',
  status: '全部'
}

export const tailingsReducer = createReducer(
  initialTailingsState,
  on(TailingsActions.loadDataset, (state) => ({ ...state, loading: true, error: '' })),
  on(TailingsActions.loadDatasetSuccess, (state, { dataset }) => ({ ...state, dataset, loading: false, selectedAnomalyId: dataset.anomalies[0]?.id ?? '' })),
  on(TailingsActions.loadDatasetFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(TailingsActions.hydrateFromStorage, (state, { dataset }) => ({
    ...state,
    dataset,
    selectedAnomalyId: dataset.anomalies.some((item) => item.id === state.selectedAnomalyId) ? state.selectedAnomalyId : dataset.anomalies[0]?.id ?? ''
  })),

  on(TailingsActions.setOnline, (state, { online }) => ({ ...state, online, syncMessage: online ? '网络已恢复，可继续上传与对账' : '山谷现场断网，复测与证据先离线留存' })),

  // —— 既有处置流程 ——
  on(TailingsActions.submitFieldReview, (state, { anomalyId, review }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !review.observed || !review.evidence || !review.reassessment) return state
    anomaly.fieldReviews.unshift({ ...review, version: anomaly.fieldReviews.length + 1 })
    anomaly.status = '原因调查中'
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '提交现场复核', review.inspector, review.reassessment))
    return { ...state, dataset }
  }),
  on(TailingsActions.addExpertOpinion, (state, { anomalyId, opinion }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !opinion.content) return state
    anomaly.opinions.unshift(opinion)
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '补充专业意见', opinion.specialist, `${opinion.conclusion}：${opinion.content}`))
    return { ...state, dataset }
  }),
  on(TailingsActions.saveDispositionPlan, (state, { anomalyId, plan }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !plan.owner || !plan.deadline || !plan.conditions) return state
    anomaly.plan = { ...plan, approvedBy: '', approvedAt: '' }
    anomaly.status = '待负责人审批'
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '提交处置方案', '当前用户', `${plan.action}，责任方${plan.owner}`))
    return { ...state, dataset }
  }),
  on(TailingsActions.approvePlan, (state, { anomalyId, approver, note }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly) return state
    if (anomaly.severity === '重大' && !anomaly.plan.emergencyLinked) return state
    anomaly.plan.approvedBy = approver
    anomaly.plan.approvedAt = new Date().toISOString()
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '审批处置方案', approver, note || '同意执行'))
    return { ...state, dataset }
  }),
  on(TailingsActions.closeAnomaly, (state, { anomalyId, note }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !anomaly.plan.approvedBy || !anomaly.fieldReviews.length || !note.trim()) return state
    anomaly.status = '已关闭'
    anomaly.closedAt = new Date().toISOString()
    anomaly.recalcState = ''
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '关闭异常', anomaly.plan.approvedBy, note))
    return { ...state, dataset }
  }),
  on(TailingsActions.createEmergencyLink, (state, { anomalyId, note }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly) return state
    anomaly.plan.emergencyLinked = true
    anomaly.status = '应急联动'
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '启动应急联动', '值班负责人', note))
    return { ...state, dataset }
  }),

  // —— 离线巡检批次（纯领域引擎驱动，可恢复、可重放） ——
  on(TailingsActions.createOfflineBatch, (state, { inspector, zone }) => {
    const { dataset, batch } = createOfflineBatch(state.dataset, inspector, zone, nowIso, ids)
    return { ...state, dataset, syncMessage: `已建立离线批次 ${batch.id}（${zone}），复测与证据离线留存` }
  }),
  on(TailingsActions.addRemeasureDraft, (state, { batchId, draft }) => {
    const dataset = addRemeasure(state.dataset, batchId, { pointId: draft.pointId, baseReadingId: draft.baseReadingId, value: draft.value, note: draft.note }, nowIso, ids)
    return dataset === state.dataset ? state : { ...state, dataset }
  }),
  on(TailingsActions.addEvidenceDraft, (state, { batchId, draft }) => {
    const dataset = addEvidence(state.dataset, batchId, { kind: draft.kind, name: draft.name, note: draft.note }, nowIso, ids)
    return dataset === state.dataset ? state : { ...state, dataset }
  }),
  on(TailingsActions.submitBatchWhenOnline, (state, { batchId }) => {
    const batch = state.dataset.offlineBatches.find((item) => item.id === batchId)
    if (!batch) return state
    if (!state.online) return { ...state, syncMessage: '仍处于断网状态，批次保持离线留存，网络恢复后自动继续' }
    if (batch.status !== '离线编辑中') return state
    const dataset = markBatchSyncing(state.dataset, batchId)
    return { ...state, dataset, syncMessage: `批次 ${batchId} 开始恢复现场证据并上传…` }
  }),
  on(TailingsActions.evidenceUploadAttempt, (state, { batchId, evidenceId, success, failReason }) => {
    const dataset = applyEvidenceUploadResult(state.dataset, batchId, evidenceId, success, failReason, nowIso, ids)
    const batch = dataset.offlineBatches.find((item) => item.id === batchId)
    const failed = batch?.evidence.filter((item) => item.uploadState === '上传失败').length ?? 0
    const done = batch?.evidence.filter((item) => item.uploadState === '已上传').length ?? 0
    const total = batch?.evidence.length ?? 0
    const syncMessage = success
      ? `证据上传成功（${done}/${total}）`
      : `第 ${batch?.evidence.find((item) => item.id === evidenceId)?.attempts ?? 1} 次上传失败：${failReason}；现场证据已保留，可继续重试`
    return { ...state, dataset, syncMessage: failed ? `${syncMessage}，待重试 ${failed} 项` : syncMessage }
  }),
  on(TailingsActions.finishBatchReconcile, (state, { batchId }) => {
    const dataset = reconcileBatch(state.dataset, batchId, nowIso, ids)
    if (dataset === state.dataset) return state
    const batch = dataset.offlineBatches.find((item) => item.id === batchId)
    return { ...state, dataset, syncMessage: `批次 ${batchId} 对账完成：${batch?.report?.note ?? ''}` }
  }),
  on(TailingsActions.retryFailedEvidence, (state, { batchId }) => {
    if (!state.online) return { ...state, syncMessage: '断网未恢复，等待网络后自动重试' }
    return { ...state, syncMessage: `继续重试批次 ${batchId} 中上传失败的现场证据…` }
  }),
  on(TailingsActions.resumePendingBatches, (state) => {
    const pending = state.dataset.offlineBatches.filter((batch) => batch.status === '证据上传中' && batch.evidence.some((item) => item.uploadState !== '已上传'))
    return pending.length ? { ...state, syncMessage: `恢复 ${pending.length} 个未完成批次，继续上传现场证据` } : state
  }),

  // —— 断网期间中心侧动作 ——
  on(TailingsActions.centerReviseReading, (state, { baseReadingId, value }) => {
    const dataset = reviseCenterReading(state.dataset, baseReadingId, value, '中心值班员', nowIso, ids)
    return dataset === state.dataset ? state : { ...state, dataset, syncMessage: `中心已将 ${baseReadingId} 正式读数修订为 ${value}` }
  }),
  on(TailingsActions.centerPublishThreshold, (state, { thresholdId, warning, alarm }) => {
    const dataset = publishThreshold(state.dataset, thresholdId, { warning, alarm }, '阈值管理员', nowIso, ids)
    const threshold = dataset.thresholds.find((item) => item.id === thresholdId)
    return dataset === state.dataset ? state : { ...state, dataset, syncMessage: `中心发布 ${thresholdId} V${threshold?.version}，相关异常将在下批对账时失效重算` }
  }),

  on(TailingsActions.selectAnomaly, (state, { anomalyId }) => ({ ...state, selectedAnomalyId: anomalyId })),
  on(TailingsActions.updateKeyword, (state, { keyword }) => ({ ...state, keyword })),
  on(TailingsActions.updateStatus, (state, { status }) => ({ ...state, status: status as TailingsState['status'] })),
  on(TailingsActions.addAudit, (state, { entry }) => ({ ...state, dataset: { ...state.dataset, audit: [entry, ...state.dataset.audit] } })),
  on(TailingsActions.resetDemo, () => ({ ...initialTailingsState, dataset: structuredClone(seedDataset), selectedAnomalyId: seedDataset.anomalies[0].id, syncMessage: '已恢复演示数据' }))
)

/** 可恢复：除加载中外，每次提交都把数据集写入本地，刷新/崩溃后继续。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const persistenceMetaReducer: MetaReducer<any> = (reducer) => {
  return (state, action) => {
    const nextState = reducer(state, action) as { tailings?: TailingsState }
    const dataset = nextState.tailings?.dataset
    if (typeof localStorage !== 'undefined' && dataset) {
      try {
        if (action.type === TailingsActions.resetDemo.type) {
          localStorage.removeItem(STORAGE_KEY)
        } else if (action.type !== TailingsActions.hydrateFromStorage.type && action.type !== TailingsActions.loadDataset.type) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(dataset))
        }
      } catch {
        // 存储不可用时退化为内存态，不影响对账逻辑
      }
    }
    return nextState
  }
}

export const readPersistedDataset = (): TailingsDataset | null => {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as TailingsDataset : null
  } catch {
    return null
  }
}

export { STORAGE_KEY }
