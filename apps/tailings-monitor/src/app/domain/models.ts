export type MonitoringType = '位移' | '水位' | '渗流' | '降雨'
export type PointStatus = '正常' | '预警' | '异常'
export type AnomalyStatus = '待现场复核' | '原因调查中' | '待负责人审批' | '应急联动' | '重算重开' | '已关闭'
export type Severity = '关注' | '较高' | '重大'

// 离线巡检批次对账状态：未上传 -> 证据上传中 -> 已对账 / 已对账单有冲突待核对
export type ReconcileStatus = '离线编辑中' | '证据上传中' | '已对账' | '已对账·待核对'
export type UploadState = '待上传' | '上传中' | '已上传' | '上传失败'
export type ReadingOrigin = '设备原始' | '中心修订' | '离线复测'
export type ReadingReconcileState = '已并入' | '冲突待核对'
export type AnomalyRecalcState = '' | '阈值失效·重开' | '阈值失效·关闭' | '按新阈值重开'
export type EvidenceKind = '照片' | '视频' | '录音' | '文档'

export interface MonitoringPoint {
  id: string
  name: string
  zone: string
  type: MonitoringType
  longitude: number
  latitude: number
  status: PointStatus
  currentValue: number
  unit: string
  thresholdId: string
  lastInspectionAt: string
}

export interface Threshold {
  id: string
  type: MonitoringType
  warning: number
  alarm: number
  changeRate: number
  unit: string
  enabled: boolean
  version: number
  updatedAt: string
}

export interface RawReading {
  id: string
  pointId: string
  value: number
  unit: string
  capturedAt: string
  deviceId: string
  quality: '有效' | '可疑' | '无效'
  // 原始读数（含中心修订）保持只读；离线复测作为独立版本并入，绝不覆盖同次读数
  origin: ReadingOrigin
  batchId?: string
  // 复测所针对的同一次原始读数
  baseReadingId?: string
  // 对账状态
  reconcileState?: ReadingReconcileState
}

export interface ExpertOpinion {
  id: string
  specialist: string
  discipline: '坝体' | '水文' | '岩土' | '应急'
  content: string
  conclusion: '支持结论' | '提出异议' | '补充证据'
  createdAt: string
}

export interface FieldReview {
  id: string
  inspector: string
  arrivedAt: string
  observed: string
  evidence: string
  reassessment: string
  version: number
}

export interface DispositionPlan {
  id: string
  action: '加密监测' | '降低库水位' | '疏通排水' | '应急撤离准备' | '工程加固'
  owner: string
  deadline: string
  conditions: string
  emergencyLinked: boolean
  approvedBy: string
  approvedAt: string
}

export interface Anomaly {
  id: string
  pointId: string
  title: string
  severity: Severity
  status: AnomalyStatus
  openedAt: string
  owner: string
  triggerReadingId: string
  observedValue: string
  fieldReviews: FieldReview[]
  opinions: ExpertOpinion[]
  plan: DispositionPlan
  closedAt: string
  version: number
  // 产生/最近重算时依据的阈值版本（如 T-D V4）
  thresholdVersion: string
  // 阈值版本变化后的失效重算结果
  recalcState: AnomalyRecalcState
  recalcNote: string
  recalcCount: number
}

export interface AuditEntry {
  id: string
  entityId: string
  action: string
  operator: string
  detail: string
  createdAt: string
  // 幂等键：同一逻辑事件重放只保留一条审计
  idemKey?: string
  batchId?: string
}

// 山谷断网时登记的复测值（一个测点可针对同一次读数复测）
export interface OfflineRemeasure {
  id: string
  pointId: string
  baseReadingId: string
  value: number
  unit: string
  measuredAt: string
  note: string
  mergedReadingId: string
}

// 现场证据（照片/视频/录音/文档），上传失败后可恢复并继续重试
export interface OfflineEvidence {
  id: string
  kind: EvidenceKind
  name: string
  note: string
  capturedAt: string
  sizeBytes: number
  uploadState: UploadState
  uploadedAt: string
  failReason: string
  attempts: number
}

// 同一测点同次读数两端分别修改时保留的双值核对记录
export interface ReadingConflict {
  id: string
  pointId: string
  baseReadingId: string
  readingKey: string
  officialValue: number
  offlineValue: number
  unit: string
  centerUpdatedAt: string
  offlineMeasuredAt: string
  mergedReadingId: string
  status: ReadingReconcileState
  batchId: string
  resolvedNote: string
}

export interface BatchThresholdSnapshot {
  thresholdId: string
  version: number
}

export interface ReconcileReport {
  reconciledAt: string
  remeasureCount: number
  evidenceCount: number
  conflictCount: number
  recalculatedAnomalyIds: string[]
  openedAnomalyIds: string[]
  thresholdVersions: BatchThresholdSnapshot[]
  note: string
}

export interface OfflineBatch {
  id: string
  inspector: string
  zone: string
  createdAt: string
  offlineSince: string
  status: ReconcileStatus
  remeasures: OfflineRemeasure[]
  evidence: OfflineEvidence[]
  // 对账时依据的阈值版本快照
  thresholdSnapshot: BatchThresholdSnapshot[]
  report: ReconcileReport | null
}

export interface TailingsDataset {
  points: MonitoringPoint[]
  thresholds: Threshold[]
  readings: RawReading[]
  anomalies: Anomaly[]
  audit: AuditEntry[]
  offlineBatches: OfflineBatch[]
  conflicts: ReadingConflict[]
}

export const nowIso = (): string => new Date().toISOString()
