export const WOONBEHOEFTE_REFRESH_STATUSES = ['REFRESHING', 'READY', 'READY_WITH_ERRORS', 'FAILED'] as const;
export type WoonbehoefteRefreshStatus = typeof WOONBEHOEFTE_REFRESH_STATUSES[number];

export interface WoonbehoefteRefreshState {
  runId: string;
  status: WoonbehoefteRefreshStatus;
  startedAt: string;
  completedAt?: string;
  lastSuccessfulAt?: string;
  failureReason?: string;
  failedCount?: number;
}

/**
 * A REFRESHING claim older than this is treated as abandoned (crashed worker, failed invoke) and can be
 * reclaimed by the next request. Comfortably above the worker's 15-minute hard Lambda timeout, the same
 * margin Sport's cache uses for its own stale claim.
 */
export const WOONBEHOEFTE_REFRESH_STALE_AFTER_MS = 20 * 60 * 1000;
