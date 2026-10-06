import type { TailingsDataset } from '../domain'

/**
 * 演示场景时间线：
 * - 巡检员 10-06 09:00 在西沟山谷断网记录批次 OB-261006-01（T-D 离场基线 V4）。
 * - 断网期间中心把 T-D 升到 V5，并将 RD-1 正式修订为 17.4mm；AN-260929-01 在 V4 下已关闭。
 * - 离线副本仍带着 RD-1 的 18.7mm；批次里一份证据上传失败，等待恢复续传。
 */
export const seedDataset: TailingsDataset = {
  points: [
    { id: 'P-D01', name: '主坝顶部位移点 D01', zone: '主坝', type: '位移', longitude: 112.832, latitude: 40.116, status: '异常', currentValue: 17.4, unit: 'mm', thresholdId: 'T-D', lastInspectionAt: '2026-10-06T07:30:00' },
    { id: 'P-D02', name: '主坝下游位移点 D02', zone: '主坝', type: '位移', longitude: 112.837, latitude: 40.111, status: '预警', currentValue: 12.4, unit: 'mm', thresholdId: 'T-D', lastInspectionAt: '2026-09-29T08:10:00' },
    { id: 'P-W01', name: '库内水位计 W01', zone: '库区', type: '水位', longitude: 112.846, latitude: 40.121, status: '预警', currentValue: 873.4, unit: 'm', thresholdId: 'T-W', lastInspectionAt: '2026-09-29T07:55:00' },
    { id: 'P-S01', name: '主坝渗流计 S01', zone: '主坝', type: '渗流', longitude: 112.827, latitude: 40.106, status: '正常', currentValue: 1.8, unit: 'L/s', thresholdId: 'T-S', lastInspectionAt: '2026-09-29T07:40:00' },
    { id: 'P-R01', name: '库区雨量站 R01', zone: '库区', type: '降雨', longitude: 112.861, latitude: 40.132, status: '正常', currentValue: 24.6, unit: 'mm/h', thresholdId: 'T-R', lastInspectionAt: '2026-09-29T08:00:00' }
  ],
  thresholds: [
    { id: 'T-D', type: '位移', warning: 10, alarm: 16, changeRate: 2.5, unit: 'mm/d', enabled: true, version: 5 },
    { id: 'T-W', type: '水位', warning: 871, alarm: 873, changeRate: 0.5, unit: 'm/h', enabled: true, version: 3 },
    { id: 'T-S', type: '渗流', warning: 2.2, alarm: 3, changeRate: 0.4, unit: 'L/s', enabled: true, version: 5 },
    { id: 'T-R', type: '降雨', warning: 30, alarm: 50, changeRate: 10, unit: 'mm/h', enabled: true, version: 2 }
  ],
  readings: [
    { id: 'RD-1', pointId: 'P-D01', value: 18.7, unit: 'mm', capturedAt: '2026-09-29T08:20:00', deviceId: 'GNSS-D01', quality: '有效', revision: 1, source: '中心修订', batchId: '' },
    { id: 'RD-2', pointId: 'P-D01', value: 16.2, unit: 'mm', capturedAt: '2026-09-29T07:20:00', deviceId: 'GNSS-D01', quality: '有效', revision: 0, source: '设备', batchId: '' },
    { id: 'RD-3', pointId: 'P-D01', value: 13.8, unit: 'mm', capturedAt: '2026-09-29T06:20:00', deviceId: 'GNSS-D01', quality: '有效', revision: 0, source: '设备', batchId: '' },
    { id: 'RD-4', pointId: 'P-W01', value: 873.4, unit: 'm', capturedAt: '2026-09-29T07:55:00', deviceId: 'WL-W01', quality: '有效', revision: 0, source: '设备', batchId: '' }
  ],
  officialRevisions: [
    { readingId: 'RD-1', pointId: 'P-D01', value: 17.4, unit: 'mm', revisedAt: '2026-10-06T07:30:00', operator: '中心值班员 何清', reason: '基准点复核后剔除粗差，正式读数修订为17.4mm', revision: 1 }
  ],
  anomalies: [
    {
      id: 'AN-260929-01', pointId: 'P-D01', title: '主坝D01累计位移超过报警阈值', severity: '重大', status: '已关闭', openedAt: '2026-09-29T08:25:00', owner: '坝体安全组', triggerReadingId: 'RD-1', observedValue: '18.7 mm，昨日变化4.2 mm/d', version: 8, closedAt: '2026-09-30T11:00:00', thresholdId: 'T-D', thresholdVersion: 4, recomputeState: '生效中', firstOpenedAt: '2026-09-29T08:25:00', reopenedByBatchId: '',
      fieldReviews: [{ id: 'FR-1', inspector: '宋立', arrivedAt: '2026-09-29T09:10:00', observed: '坝顶排水沟未见明显开裂，D01附近无新增裂缝，基准点稳定。', evidence: 'D01近景照片、基准点复核记录、GNSS原始观测文件', reassessment: '读数有效，位移趋势仍上升，建议立即降低库水位并加密监测。', version: 2 }],
      opinions: [
        { id: 'OP-1', specialist: '周岩', discipline: '岩土', content: '近三日位移速率持续高于阈值，需结合孔隙水压力分析潜在滑面。', conclusion: '支持结论', createdAt: '2026-09-29T10:20:00' },
        { id: 'OP-2', specialist: '许洁', discipline: '水文', content: '库水位仍接近警戒线，建议优先降低库水位并核对上游来水。', conclusion: '补充证据', createdAt: '2026-09-29T10:45:00' }
      ],
      plan: { id: 'PL-1', action: '降低库水位', owner: '库区调度班', deadline: '2026-09-29T18:00:00', conditions: '每2小时复测D01、D02和W01；位移速率恢复至3mm/d以下并稳定12小时后，负责人可关闭异常。', emergencyLinked: true, approvedBy: '负责人 何清', approvedAt: '2026-09-29T15:30:00' }
    },
    {
      id: 'AN-260929-02', pointId: 'P-W01', title: '库水位短时上升速率超预警值', severity: '较高', status: '原因调查中', openedAt: '2026-09-29T08:00:00', owner: '库区调度班', triggerReadingId: 'RD-4', observedValue: '873.4 m，1小时上升0.6 m', version: 4, closedAt: '', thresholdId: 'T-W', thresholdVersion: 3, recomputeState: '生效中', firstOpenedAt: '2026-09-29T08:00:00', reopenedByBatchId: '',
      fieldReviews: [], opinions: [{ id: 'OP-3', specialist: '许洁', discipline: '水文', content: '上游降雨汇流导致入湖量增加，需核实泄洪闸状态。', conclusion: '支持结论', createdAt: '2026-09-29T09:00:00' }],
      plan: { id: 'PL-2', action: '加密监测', owner: '库区调度班', deadline: '2026-09-29T14:00:00', conditions: '每小时记录水位与入库流量，达到874.0m时启动应急联动。', emergencyLinked: false, approvedBy: '', approvedAt: '' }
    }
  ],
  offlineBatches: [
    {
      id: 'OB-261006-01',
      inspector: '宋立',
      valley: '西沟山谷巡检线',
      recordedAt: '2026-10-06T09:00:00',
      readings: [
        { id: 'RM-1', pointId: 'P-D01', readingId: 'RD-1', value: 18.7, unit: 'mm', measuredAt: '2026-10-06T09:05:00', inspector: '宋立', note: '现场复测，坝顶未见新裂缝' },
        { id: 'RM-2', pointId: 'P-W01', readingId: 'RD-4', value: 872.2, unit: 'm', measuredAt: '2026-10-06T09:20:00', inspector: '宋立', note: '水位计现场比对读数' },
        { id: 'RM-3', pointId: 'P-S01', readingId: '', value: 3.4, unit: 'L/s', measuredAt: '2026-10-06T09:40:00', inspector: '宋立', note: '渗流点新增复测，浑浊度偏高' }
      ],
      evidence: [
        { id: 'EV-1', filename: 'D01-坝顶裂缝核查.jpg', kind: '照片', digest: 'sha256:9f2c...a1', bytes: 2_184_332, capturedAt: '2026-10-06T09:06:00', state: '已上传', attempts: 1, lastError: '' },
        { id: 'EV-2', filename: 'S01-渗流出水点.mp4', kind: '视频', digest: 'sha256:41be...77', bytes: 18_662_004, capturedAt: '2026-10-06T09:42:00', state: '失败待重试', attempts: 2, lastError: '网络恢复后上传中断（连接重置），现场证据保留待续传' },
        { id: 'EV-3', filename: '西沟巡检纸质记录签名.pdf', kind: '签名', digest: 'sha256:7d10...e3', bytes: 482_110, capturedAt: '2026-10-06T09:55:00', state: '待上传', attempts: 0, lastError: '' }
      ],
      thresholdBaseline: { 'T-D': 4, 'T-W': 3, 'T-S': 5, 'T-R': 2 },
      reconcileStatus: '未对账',
      reconcileLines: [],
      commitStage: '失败待恢复',
      lastError: 'EV-2上传中断，已保留现场证据检查点',
      reconciledAt: '',
      mergedAt: '',
      mergedThresholdVersions: {}
    }
  ],
  audit: [
    { id: 'A-1', entityId: 'P-D01', action: '生成异常', operator: '阈值引擎', detail: '累计位移18.7mm超过报警阈值16mm', createdAt: '2026-09-29T08:25:00', batchId: '', thresholdVersion: 4, idempotencyKey: 'seed:anomaly:AN-260929-01' },
    { id: 'A-2', entityId: 'AN-260929-01', action: '提交现场复核', operator: '宋立', detail: '原始读数有效，位移趋势仍上升', createdAt: '2026-09-29T09:25:00', batchId: '', thresholdVersion: 4, idempotencyKey: 'seed:review:FR-1' },
    { id: 'A-3', entityId: 'AN-260929-01', action: '补充专业意见', operator: '周岩', detail: '建议结合孔隙水压力分析潜在滑面', createdAt: '2026-09-29T10:20:00', batchId: '', thresholdVersion: 4, idempotencyKey: 'seed:opinion:OP-1' },
    { id: 'A-4', entityId: 'T-D', action: '阈值版本变更', operator: '监测中心', detail: '位移变化率由3.0收紧至2.5mm/d，报警值16mm不变，V4→V5；V4下已关闭异常待离线批次合并时按V5复核', createdAt: '2026-10-06T06:00:00', batchId: '', thresholdVersion: 5, idempotencyKey: 'seed:threshold:T-D:v5' },
    { id: 'A-5', entityId: 'RD-1', action: '中心正式读数修订', operator: '中心值班员 何清', detail: '基准点复核后正式读数修订为17.4mm，原始18.7mm留档', createdAt: '2026-10-06T07:30:00', batchId: '', thresholdVersion: 5, idempotencyKey: 'seed:revision:RD-1:v1' },
    { id: 'A-6', entityId: 'AN-260929-01', action: '关闭异常', operator: '负责人 何清', detail: '复测数据稳定，V4关闭条件已满足', createdAt: '2026-09-30T11:00:00', batchId: '', thresholdVersion: 4, idempotencyKey: 'seed:close:AN-260929-01' }
  ]
}
