import { createReducer, on } from '@ngrx/store'
import type { Anomaly, AuditEntry, DispositionPlan, TailingsDataset } from '../domain'
import { seedDataset } from '../data/seed'
import {
  bumpThreshold,
  markEvidenceAttempt,
  mergeBatch,
  reconcileBatch,
  recoverBatchStage
} from '../domain/reconcile'
import { TailingsActions } from './tailings.actions'

export const STORAGE_KEY = 'tailings-monitor-dataset-v2'

export interface TailingsState {
  dataset: TailingsDataset
  loading: boolean
  error: string
  selectedAnomalyId: string
  keyword: string
  status: Anomaly['status'] | '全部'
}

const nowIso = (): string => new Date().toISOString()

const loadSeed = (): TailingsDataset => {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved) as TailingsDataset
  } catch {
    /* 存储不可用时退回种子数据 */
  }
  return structuredClone(seedDataset)
}

export const initialTailingsState: TailingsState = (() => {
  const dataset = loadSeed()
  return {
    dataset,
    loading: false,
    error: '',
    selectedAnomalyId: dataset.anomalies[0]?.id ?? '',
    keyword: '',
    status: '全部'
  }
})()

let idSeed = 50
const audit = (entityId: string, action: string, operator: string, detail: string, batchId = '', thresholdVersion = 0): AuditEntry => ({
  id: `AUD-${Date.now()}-${idSeed++}`,
  entityId,
  action,
  operator,
  detail,
  createdAt: nowIso(),
  batchId,
  thresholdVersion,
  idempotencyKey: `ui:${entityId}:${action}:${Date.now()}-${idSeed}`
})

const findBatch = (dataset: TailingsDataset, batchId: string) => dataset.offlineBatches.find((item) => item.id === batchId)

export const tailingsReducer = createReducer(
  initialTailingsState,
  on(TailingsActions.loadDataset, (state) => ({ ...state, loading: true, error: '' })),
  on(TailingsActions.loadDatasetSuccess, (state, { dataset }) => ({ ...state, dataset, loading: false, selectedAnomalyId: dataset.anomalies[0]?.id ?? '' })),
  on(TailingsActions.loadDatasetFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(TailingsActions.submitFieldReview, (state, { anomalyId, review }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !review.observed || !review.evidence || !review.reassessment) return state
    anomaly.fieldReviews.unshift({ ...review, version: anomaly.fieldReviews.length + 1 })
    if (anomaly.status === '待现场复核' || anomaly.status === '重算失效') anomaly.status = '原因调查中'
    if (anomaly.recomputeState === '重算失效') anomaly.recomputeState = '生效中'
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
    anomaly.plan.approvedAt = nowIso()
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '审批处置方案', approver, note || '同意执行'))
    return { ...state, dataset }
  }),
  on(TailingsActions.closeAnomaly, (state, { anomalyId, note }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !anomaly.plan.approvedBy || !anomaly.fieldReviews.length || !note.trim()) return state
    anomaly.status = '已关闭'
    anomaly.closedAt = nowIso()
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
  on(TailingsActions.bumpThreshold, (state, { thresholdId, patch, operator }) => ({
    ...state,
    dataset: bumpThreshold(state.dataset, thresholdId, patch, operator, nowIso())
  })),
  on(TailingsActions.recoverPendingCommits, (state) => {
    const dataset = structuredClone(state.dataset)
    let changed = false
    for (const batch of dataset.offlineBatches) {
      const recovered = recoverBatchStage(batch)
      if (JSON.stringify(recovered) !== JSON.stringify(batch)) changed = true
      Object.assign(batch, recovered)
    }
    return changed ? { ...state, dataset } : state
  }),
  on(TailingsActions.uploadEvidence, (state, { batchId, evidenceId }) => {
    const dataset = structuredClone(state.dataset)
    const batch = findBatch(dataset, batchId)
    const evidence = batch?.evidence.find((item) => item.id === evidenceId)
    if (!batch || !evidence || evidence.state === '已上传' || evidence.state === '上传中') return state
    evidence.state = '上传中'
    if (batch.commitStage === '待提交' || batch.commitStage === '失败待恢复') batch.commitStage = '证据上传中'
    batch.lastError = ''
    return { ...state, dataset }
  }),
  on(TailingsActions.uploadEvidenceDone, (state, { batchId, evidenceId, ok, error }) => {
    const dataset = structuredClone(state.dataset)
    const batch = findBatch(dataset, batchId)
    if (!batch) return state
    Object.assign(batch, markEvidenceAttempt(batch, evidenceId, { ok, error }))
    return { ...state, dataset }
  }),
  on(TailingsActions.reconcileBatch, (state, { batchId }) => ({
    ...state,
    dataset: reconcileBatch(state.dataset, batchId, nowIso())
  })),
  on(TailingsActions.mergeBatch, (state, { batchId }) => ({
    ...state,
    dataset: mergeBatch(state.dataset, batchId, nowIso())
  })),
  on(TailingsActions.resolveReadingConflict, (state, { batchId, readingId, resolution, operator, note }) => {
    const dataset = structuredClone(state.dataset)
    const batch = findBatch(dataset, batchId)
    if (!batch || batch.reconcileStatus !== '待核对') return state
    const line = batch.reconcileLines.find((item) => item.readingId === readingId && item.status === '冲突待核对')
    if (!line) return state
    const reading = dataset.readings.find((item) => item.id === readingId)
    if (!reading) return state

    if (resolution === '登记正式修订') {
      // 人工核对后把离线复测值登记为新的中心正式修订（审计明确说明，不悄悄覆盖）
      const previous = dataset.officialRevisions.filter((item) => item.readingId === readingId)
      const nextRevision = (previous.at(-1)?.revision ?? reading.revision) + 1
      dataset.officialRevisions.push({
        readingId,
        pointId: reading.pointId,
        value: line.offlineValue ?? reading.value,
        unit: reading.unit,
        revisedAt: nowIso(),
        operator,
        reason: note || `离线批次${batchId}复测经人工核对确认为正式值`,
        revision: nextRevision
      })
      reading.source = '中心修订'
      reading.revision = nextRevision
      line.officialValue = line.offlineValue
      line.status = '一致'
      line.note = `人工核对后登记V${nextRevision}正式修订${line.offlineValue}${line.unit}，双方值已统一（原正式值留档）`
      dataset.audit.unshift(audit(readingId, '登记正式修订', operator, line.note, batchId, 0))
    } else {
      line.status = '中心值生效'
      line.note = `人工核对确认中心正式值${line.officialValue}${line.unit}为准，离线复测${line.offlineValue}${line.unit}留档不覆盖`
      dataset.audit.unshift(audit(readingId, '确认中心正式读数', operator, line.note, batchId, 0))
    }
    if (batch.reconcileLines.every((item) => item.status !== '冲突待核对')) {
      batch.reconcileStatus = '已对账'
      dataset.audit.unshift(audit(batchId, '对账冲突核对完成', operator, '全部读数冲突已人工核对，批次可合并入库', batchId, 0))
    }
    return { ...state, dataset }
  }),
  on(TailingsActions.selectAnomaly, (state, { anomalyId }) => ({ ...state, selectedAnomalyId: anomalyId })),
  on(TailingsActions.updateKeyword, (state, { keyword }) => ({ ...state, keyword })),
  on(TailingsActions.updateStatus, (state, { status }) => ({ ...state, status: status as TailingsState['status'] })),
  on(TailingsActions.addAudit, (state, { entry }) => ({ ...state, dataset: { ...state.dataset, audit: [entry, ...state.dataset.audit] } })),
  on(TailingsActions.resetDemo, (): TailingsState => {
    try { globalThis.localStorage?.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    return { ...initialTailingsState, dataset: structuredClone(seedDataset), selectedAnomalyId: seedDataset.anomalies[0].id, status: '全部', keyword: '' }
  })
)
