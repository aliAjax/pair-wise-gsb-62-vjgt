import { createActionGroup, emptyProps, props } from '@ngrx/store'
import type {
  AuditEntry,
  DispositionPlan,
  EvidenceKind,
  ExpertOpinion,
  FieldReview,
  TailingsDataset
} from '../domain'

export interface RemeasureDraft {
  pointId: string
  baseReadingId: string
  value: number
  note: string
}

export interface EvidenceDraft {
  kind: EvidenceKind
  name: string
  note: string
}

export const TailingsActions = createActionGroup({
  source: 'Tailings',
  events: {
    'Load Dataset': emptyProps(),
    'Load Dataset Success': props<{ dataset: TailingsDataset }>(),
    'Load Dataset Failure': props<{ error: string }>(),
    'Hydrate From Storage': props<{ dataset: TailingsDataset }>(),
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

    // 离线巡检批次（可恢复提交）
    'Set Online': props<{ online: boolean }>(),
    'Create Offline Batch': props<{ inspector: string; zone: string }>(),
    'Add Remeasure Draft': props<{ batchId: string; draft: RemeasureDraft }>(),
    'Add Evidence Draft': props<{ batchId: string; draft: EvidenceDraft }>(),
    'Submit Batch When Online': props<{ batchId: string }>(),
    'Evidence Upload Attempt': props<{ batchId: string; evidenceId: string; success: boolean; failReason: string }>(),
    'Finish Batch Reconcile': props<{ batchId: string }>(),
    'Retry Failed Evidence': props<{ batchId: string }>(),
    'Resume Pending Batches': emptyProps(),
    // 断网期间中心侧事件（演示对账条件）
    'Center Revise Reading': props<{ baseReadingId: string; value: number }>(),
    'Center Publish Threshold': props<{ thresholdId: string; warning: number; alarm: number }>(),

    'Reset Demo': emptyProps()
  }
})
