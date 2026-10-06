export type MonitoringType = '位移' | '水位' | '渗流' | '降雨'
export type PointStatus = '正常' | '预警' | '异常'
export type AnomalyStatus = '待现场复核' | '原因调查中' | '待负责人审批' | '应急联动' | '已关闭' | '重算失效'
export type Severity = '关注' | '较高' | '重大'

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
}

export interface RawReading {
  id: string
  pointId: string
  value: number
  unit: string
  capturedAt: string
  deviceId: string
  quality: '有效' | '可疑' | '无效'
  /** 中心正式读数版本，对账时作为权威基线 */
  revision: number
  /** 纳入来源：设备、离线批次或中心修订 */
  source: '设备' | '离线批次' | '中心修订'
  /** 离线批次编号，非离线来源为空 */
  batchId: string
}

/** 原始读数的一次中心修订，正式值不允许被迟到离线副本覆盖 */
export interface ReadingRevision {
  readingId: string
  pointId: string
  value: number
  unit: string
  revisedAt: string
  operator: string
  reason: string
  revision: number
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
  /** 触发该异常时所用阈值的id */
  thresholdId: string
  /** 触发该异常时所用阈值的版本，低于当前版本即失效重算 */
  thresholdVersion: number
  /** 重算状态：阈值版本变化后失效，重算后重新生效/失效；关闭异常会被重开 */
  recomputeState: '生效中' | '已失效待重算' | '重算重开' | '重算失效'
  /** 首次打开时间，重开时保留 */
  firstOpenedAt: string
  /** 被哪个离线批次的对账重算重开 */
  reopenedByBatchId: string
}

export interface AuditEntry {
  id: string
  entityId: string
  action: string
  operator: string
  detail: string
  createdAt: string
  /** 离线批次编号，非离线对账产生的记录为空 */
  batchId: string
  /** 阈值版本，记录发生时相关阈值的版本 */
  thresholdVersion: number
  /**
   * 幂等键：重放（断点续传、重复合并）时相同键只保留一条，
   * 保证可恢复提交重放不会多出审计记录。
   */
  idempotencyKey: string
}

/** 离线批次对账状态 */
export type ReconcileStatus = '未对账' | '待核对' | '已对账' | '已合并'
/** 单条复测读数的对账结果 */
export type ReadingReconcileStatus = '新增读数' | '中心值生效' | '冲突待核对' | '一致'
/** 现场证据上传状态 */
export type EvidenceState = '待上传' | '上传中' | '已上传' | '失败待重试'

/** 巡检员在断网现场记录的复测值 */
export interface OfflineRemeasure {
  id: string
  pointId: string
  /** 同次读数id：若与中心已有读数对应则填，否则为空表示新增读数 */
  readingId: string
  value: number
  unit: string
  measuredAt: string
  inspector: string
  note: string
}

/** 断网现场采集的证据（照片、签名文件等），断网恢复后逐个上传 */
export interface FieldEvidence {
  id: string
  filename: string
  kind: '照片' | '视频' | '签名' | '观测记录'
  /** 内容摘要；真实工程中为文件引用与哈希，这里用摘要代表可恢复的现场证据 */
  digest: string
  bytes: number
  capturedAt: string
  state: EvidenceState
  attempts: number
  lastError: string
}

/** 同一测点同次读数的对账行，两端都修改时保留双方值待核对 */
export interface ReconcileLine {
  /** 对应离线复测记录id */
  remeasureId: string
  readingId: string
  pointId: string
  offlineValue: number | null
  officialValue: number | null
  unit: string
  status: ReadingReconcileStatus
  note: string
}

/**
 * 可恢复的离线巡检提交：
 * 本地采集 → 证据上传（失败可断点续传）→ 中心对账 → 合并入库。
 * 各阶段进度落在批次上，刷新/崩溃后可从最后检查点继续。
 */
export interface OfflineBatch {
  id: string
  inspector: string
  valley: string
  recordedAt: string
  readings: OfflineRemeasure[]
  evidence: FieldEvidence[]
  /** 批次离场时各阈值版本的快照 */
  thresholdBaseline: Record<string, number>
  reconcileStatus: ReconcileStatus
  reconcileLines: ReconcileLine[]
  /** 提交检查点：证据上传阶段与最终合并阶段各自幂等 */
  commitStage: '待提交' | '证据上传中' | '待对账' | '对账完成' | '已合并' | '失败待恢复'
  lastError: string
  reconciledAt: string
  mergedAt: string
  mergedThresholdVersions: Record<string, number>
}

export interface TailingsDataset {
  points: MonitoringPoint[]
  thresholds: Threshold[]
  readings: RawReading[]
  anomalies: Anomaly[]
  audit: AuditEntry[]
  /** 中心对原始读数的正式修订（权威基线，离线迟到副本不得覆盖） */
  officialRevisions: ReadingRevision[]
  /** 离线巡检批次与可恢复提交进度 */
  offlineBatches: OfflineBatch[]
}
