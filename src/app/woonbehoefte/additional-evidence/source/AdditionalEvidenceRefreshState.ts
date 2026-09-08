export const ADDITIONAL_EVIDENCE_REFRESH_STATUSES = ['REFRESHING', 'READY', 'READY_WITH_ERRORS', 'FAILED'] as const;
export type AdditionalEvidenceRefreshStatus = typeof ADDITIONAL_EVIDENCE_REFRESH_STATUSES[number];

export interface AdditionalEvidenceRefreshState {
  runId: string;
  status: AdditionalEvidenceRefreshStatus;
  startedAt: string;
  completedAt?: string;
  lastSuccessfulAt?: string;
  failureReason?: string;
  failedCount?: number;
}

/**
 * A REFRESHING claim older than this is treated as abandoned (crashed worker, failed invoke) and can be
 * reclaimed by the next request. Same margin the primary Woonbehoefte cache uses for its own stale claim.
 */
export const ADDITIONAL_EVIDENCE_REFRESH_STALE_AFTER_MS = 20 * 60 * 1000;
