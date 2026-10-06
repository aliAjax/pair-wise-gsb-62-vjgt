import { createActionGroup, emptyProps, props } from '@ngrx/store'
import type {
  AuditEntry,
  DispositionPlan,
  ExpertOpinion,
  FieldReview,
  TailingsDataset,
  Threshold
} from '../domain'

export const TailingsActions = createActionGroup({
  source: 'Tailings',
  events: {
    'Load Dataset': emptyProps(),
    'Load Dataset Success': props<{ dataset: TailingsDataset }>(),
    'Load Dataset Failure': props<{ error: string }>(),
    'Submit Field Review': props<{ anomalyId: string; review: FieldReview }>(),
    'Add Expert Opinion': props<{ anomalyId: string; opinion: ExpertOpinion }>(),
    'Save Disposition Plan': props<{ anomalyId: string; plan: DispositionPlan }>(),
    'Approve Plan': props<{ anomalyId: string; approver: string; note: string }>(),
    'Close Anomaly': props<{ anomalyId: string; note: string }>(),
    'Create Emergency Link': props<{ anomalyId: string; note: string }>(),
    'Select Anomaly': props<{ anomalyId: string }>(),
    'Update Keyword': props<{ keyword: string }>(),
    'Update Status': props<{ status: string }>(),
    'Add Audit': props<{ entry: AuditEntry }>(),
    /** 中心发布新阈值版本，相关异常失效重算 */
    'Bump Threshold': props<{ thresholdId: string; patch: Partial<Pick<Threshold, 'warning' | 'alarm' | 'changeRate' | 'enabled'>>; operator: string }>(),
    /** 刷新/重启后恢复可恢复提交的检查点（证据上传中→失败待重试） */
    'Recover Pending Commits': emptyProps(),
    /** 续传单份现场证据 */
    'Upload Evidence': props<{ batchId: string; evidenceId: string }>(),
    'Upload Evidence Done': props<{ batchId: string; evidenceId: string; ok: boolean; error?: string }>(),
    /** 与中心对账（只产出双方值对账行，不覆盖中心正式读数） */
    'Reconcile Batch': props<{ batchId: string }>(),
    /** 对账完成后纳入原始读数、阈值版本与异常处置 */
    'Merge Batch': props<{ batchId: string }>(),
    /** 人工核对冲突读数：确认中心值或登记新的正式修订 */
    'Resolve Reading Conflict': props<{ batchId: string; readingId: string; resolution: '确认中心值' | '登记正式修订'; operator: string; note: string }>(),
    'Reset Demo': emptyProps()
  }
})
