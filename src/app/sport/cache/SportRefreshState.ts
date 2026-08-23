export const SPORT_REFRESH_STATUSES = ['REFRESHING', 'READY', 'READY_WITH_ERRORS', 'FAILED'] as const;
export type SportRefreshStatus = typeof SPORT_REFRESH_STATUSES[number];

export interface SportRefreshState {
  runId: string;
  status: SportRefreshStatus;
  startedAt: string;
  completedAt?: string;
  lastSuccessfulAt?: string;
  failureReason?: string;
  failedCount?: number;
}

/**
 * A REFRESHING claim older than this is treated as abandoned (crashed worker, failed invoke) and can be
 * reclaimed by the next request. Comfortably above the worker's 15-minute hard Lambda timeout, the same
 * margin the Sport reporter uses for its own stale BUILDING claim.
 */
export const SPORT_REFRESH_STALE_AFTER_MS = 20 * 60 * 1000;

export function isStaleRefresh(state: SportRefreshState, now: Date = new Date()): boolean {
  return state.status === 'REFRESHING' && now.getTime() - new Date(state.startedAt).getTime() > SPORT_REFRESH_STALE_AFTER_MS;
}
