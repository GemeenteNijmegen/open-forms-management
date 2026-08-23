import { SportSubmissionDetails } from '../sportdata/SportSubmissionDetails';

/**
 * Bumped when the cached shape/meaning changes; the worker treats an item on an older version as a miss
 * and rebuilds it from Open Zaak, so there's no migration step for existing cache entries.
 */
export const SPORT_CACHE_VERSION = 1;

/** One fully parsed and validated Sportinzending, keyed by its immutable Objects `objectUuid`. */
export interface CachedSportSubmission {
  status: 'READY';
  objectUuid: string;
  reference: string;
  hasPdf: boolean;
  registrationAt: string;
  data: SportSubmissionDetails;
  cachedAt: string;
  expiresAt: number;
  cacheVersion: number;
}

/**
 * What's kept for an `objectUuid` whose CSV fetch/parse failed, so the next refresh retries just that one.
 * `reference` (Kenmerk) is only known once the Object itself was readable; a document that failed before
 * that point has no reference to show. No name/email/phone/CSV content ever ends up in a failure marker.
 */
export interface SportCacheFailureMarker {
  status: 'FAILED';
  objectUuid: string;
  reference?: string;
  failureReason: string;
  lastAttemptAt: string;
  expiresAt: number;
}

export type SportCacheItem = CachedSportSubmission | SportCacheFailureMarker;

export function isCachedSportSubmission(item: SportCacheItem): item is CachedSportSubmission {
  return item.status === 'READY';
}

export function isFailureMarker(item: SportCacheItem): item is SportCacheFailureMarker {
  return item.status === 'FAILED';
}
