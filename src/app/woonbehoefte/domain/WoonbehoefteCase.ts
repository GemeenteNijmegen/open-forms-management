import { CaseStatus } from './CaseStatus';

export type TernaryAssessment = 'YES' | 'NO' | 'NOT_APPLICABLE' | 'UNKNOWN';

export interface CaseCheck {
  requested: boolean;
  requestedAt?: string;
  requestedBy?: string;
  requestNoteId?: string;
  lastCheckedAt?: string;
  lastCheckedBy?: string;
  lastOutcome?: 'OK' | 'CHANGES_NEEDED';
}

/** Storage only; the feature has no ranking UI or business rules. */
export interface CaseRanking {
  period?: number;
  rank?: number;
  rankAfterLottery?: number;
  lottery?: boolean;
}

export interface CaseAssessment {
  applicationComplete?: TernaryAssessment;
  boardDeclarationApproved?: TernaryAssessment;
  chamberOfCommerceApproved?: TernaryAssessment;
  planningAgreementEvidenceApproved?: TernaryAssessment;
  planningPublicDecisionEvidenceApproved?: TernaryAssessment;

  assessedStartPeriod?: number;
  assessedStartExplanation?: string;
  assessedCompletionPeriod?: number;
  assessedCompletionExplanation?: string;
  assessedProjectReadiness?: 1 | 2 | 3 | 4 | 5 | 6;
  projectReadinessEvidenceApproved?: TernaryAssessment;
}

export interface WoonbehoefteCase {
  /** Original OF-reference of the primary submission; also the case's identity/partition key. */
  caseReference: string;

  status: CaseStatus;
  /** Set on creation and on every status-affecting mutation; distinct from `updatedAt`, which also moves on unrelated edits like a new note. */
  statusChangedAt: string;

  claimedBy?: string;
  claimedAt?: string;

  assessment: CaseAssessment;

  check: CaseCheck;

  ranking?: CaseRanking;

  version: number;

  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export type CaseSourceRelation = 'PRIMARY' | 'ADDITIONAL';

export interface CaseSourceLink {
  caseReference: string;
  submissionId: string;
  submissionReference: string;
  relation: CaseSourceRelation;
  linkedAt: string;
  /** Optional so existing PRIMARY links never need a migration; every new ADDITIONAL link sets it. */
  linkedBy?: string;
}

export type CaseNoteCategory =
  | 'GENERAL'
  | 'CONTACT'
  | 'ASSESSMENT'
  | 'ADDITIONAL_INFORMATION'
  | 'ADMISSIBILITY'
  | 'CHECK';

export interface CaseNote {
  noteId: string;
  caseReference: string;
  category: CaseNoteCategory;
  text: string;
  createdAt: string;
  createdBy: string;
}

export type CaseActivityType =
  | 'CASE_CREATED'
  | 'CASE_CLAIMED'
  | 'CASE_RELEASED'
  | 'CASE_TAKEN_OVER'
  | 'STATUS_CHANGED'
  | 'ASSESSMENT_UPDATED'
  | 'NOTE_ADDED'
  | 'CHECK_REQUESTED'
  | 'CHECK_COMPLETED'
  | 'ADDITIONAL_EVIDENCE_LINKED';

export interface CaseActivityChange {
  field: string;
  from?: string | number | boolean;
  to?: string | number | boolean;
}

export interface CaseActivity {
  activityId: string;
  caseReference: string;
  type: CaseActivityType;
  actor: string;
  occurredAt: string;
  summary: string;
  changes?: CaseActivityChange[];
}
