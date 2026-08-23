import { CachedSportSubmission, SPORT_CACHE_VERSION, SportCacheFailureMarker, SportCacheItem } from './SportCacheItem';
import { SportCacheStore } from './SportCacheStore';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { ObjectsClient } from '../../../shared/clients/objects/ObjectsClient';
import { ObjectResource, requireRegistrationAt } from '../../../shared/clients/objects/ObjectsResponse';
import { OpenZaakClient } from '../../../shared/clients/open-zaak/OpenZaakClient';
import { fetchSportCsvDocuments } from '../sportdata/fetchSportCsvDocuments';
import { SPORT_DISTRICTS } from '../sportdata/SportDistrictAuthorization';
import { collectSportObjectsFrom } from '../sportdata/SportObjectsQuery';
import { sportOverviewVisibleFrom, sportSubmissionExpiresAt } from '../sportdata/SportOverviewPolicy';
import { buildSportSubmissionDetails } from '../sportdata/SportSubmissionDetails';

export interface SportCacheWorkerDependencies {
  objectsClient: ObjectsClient;
  openZaakClient: OpenZaakClient;
  cacheStore: SportCacheStore;
}

// The worker calls Open Zaak on its own behalf, not on behalf of the medewerker whose page-open/refresh triggered it.
const WORKER_ACTOR: EmployeeIdentity = { principalId: 'sport-cache-worker' };
const KNOWN_DISTRICTS = new Set<string>(SPORT_DISTRICTS);

function toEpochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function isKnownCacheHit(item: SportCacheItem): boolean {
  return item.status === 'READY' && item.cacheVersion === SPORT_CACHE_VERSION;
}

/**
 * Checks the current Objects scope against the cache and processes only unknown/failed/outdated
 * objectUuid's. `isPastCutoff` is checked between phases, not mid-CSV-batch, the same pragmatic
 * granularity `runSportExcelReport` uses; real Sport volumes stay well inside the 15-minute Lambda timeout.
 */
export async function runSportCacheRefresh(
  runId: string,
  deps: SportCacheWorkerDependencies,
  isPastCutoff: () => boolean,
  triggerCorrelationId: string,
): Promise<void> {
  const startedAt = Date.now();
  const state = await deps.cacheStore.getState();
  if (state?.runId !== runId || state.status !== 'REFRESHING') {
    logger.debug('Sport cache worker skipped: runId is no longer the active refresh', { runId, triggerCorrelationId });
    return;
  }

  logger.info('Sport cache refresh started', { runId, triggerCorrelationId });
  const now = new Date();
  const visibleFrom = sportOverviewVisibleFrom(now).toISOString().slice(0, 10);

  let objects: ObjectResource[];
  try {
    const objectsStartedAt = Date.now();
    objects = await collectSportObjectsFrom(deps.objectsClient, visibleFrom);
    logger.debug('Sport cache objects scope resolved', {
      runId, visibleFrom, objectsCount: objects.length, objectsDurationMs: Date.now() - objectsStartedAt,
    });
  } catch (error) {
    logger.error('Sport cache refresh failed: Objects query failed', { runId, reason: errorReason(error) });
    await deps.cacheStore.finalizeRefresh(runId, 'FAILED', now, { failureReason: 'OBJECTS_ERROR' });
    return;
  }

  const objectsByUuid = new Map(objects.filter((object) => object.uuid).map((object) => [object.uuid as string, object]));
  const cacheItems = await deps.cacheStore.getItems([...objectsByUuid.keys()]);
  const objectsToFetch = [...objectsByUuid.values()].filter((object) => {
    const cached = cacheItems.get(object.uuid as string);
    return !cached || !isKnownCacheHit(cached);
  });

  logger.debug('Sport cache lookup finished', {
    runId,
    objectsCount: objectsByUuid.size,
    cacheHitCount: objectsByUuid.size - objectsToFetch.length,
    cacheMissCount: objectsToFetch.length,
    failedRetryCount: [...cacheItems.values()].filter((item) => item.status === 'FAILED').length,
  });

  if (isPastCutoff()) {
    await finalizeAsCutoff(deps.cacheStore, runId, now, startedAt);
    return;
  }

  if (objectsToFetch.length === 0) {
    await deps.cacheStore.finalizeRefresh(runId, 'READY', now, {});
    logger.info('Sport cache refresh completed', { runId, newCount: 0, failedCount: 0, durationMs: Date.now() - startedAt, outcome: 'READY' });
    return;
  }

  const csvBatchStartedAt = Date.now();
  const fetchResult = await fetchSportCsvDocuments(deps.openZaakClient, objectsToFetch, WORKER_ACTOR);
  logger.debug('Sport cache CSV batch finished', {
    runId, csvBatchCount: objectsToFetch.length, csvFetchDurationMs: Date.now() - csvBatchStartedAt,
  });

  let newCount = 0;
  let failedCount = fetchResult.failedCount;
  const parseStartedAt = Date.now();

  for (const document of fetchResult.documents) {
    if (!document.objectUuid) {
      continue;
    }
    const object = objectsByUuid.get(document.objectUuid);
    try {
      const details = buildSportSubmissionDetails(document.csvText);
      if (!KNOWN_DISTRICTS.has(details.district)) {
        throw new Error('Sport submission has an unknown district');
      }
      const submission: CachedSportSubmission = {
        status: 'READY',
        objectUuid: document.objectUuid,
        reference: document.reference,
        hasPdf: document.hasPdf,
        registrationAt: object ? requireRegistrationAt(object) : now.toISOString(),
        data: details,
        cachedAt: now.toISOString(),
        expiresAt: toEpochSeconds(sportSubmissionExpiresAt(details.submittedAt)),
        cacheVersion: SPORT_CACHE_VERSION,
      };
      await deps.cacheStore.putReady(submission);
      newCount += 1;
    } catch (error) {
      failedCount += 1;
      const marker: SportCacheFailureMarker = {
        status: 'FAILED',
        objectUuid: document.objectUuid,
        reference: document.reference,
        failureReason: errorReason(error),
        lastAttemptAt: now.toISOString(),
        expiresAt: toEpochSeconds(sportSubmissionExpiresAt(now)),
      };
      await deps.cacheStore.putFailed(marker);
      logger.warn('Sport cache submission failed to parse/validate', { runId, objectUuid: document.objectUuid, reason: errorReason(error) });
    }
  }

  for (const failedDocument of fetchResult.failedDocuments) {
    if (!failedDocument.objectUuid) {
      continue;
    }
    await deps.cacheStore.putFailed({
      status: 'FAILED',
      objectUuid: failedDocument.objectUuid,
      ...(failedDocument.reference ? { reference: failedDocument.reference } : {}),
      failureReason: 'CSV_FETCH_ERROR',
      lastAttemptAt: now.toISOString(),
      expiresAt: toEpochSeconds(sportSubmissionExpiresAt(now)),
    });
  }
  logger.debug('Sport cache writes finished', { runId, newCount, failedCount, parseDurationMs: Date.now() - parseStartedAt });

  if (isPastCutoff()) {
    await finalizeAsCutoff(deps.cacheStore, runId, now, startedAt);
    return;
  }

  const outcome = failedCount > 0 ? 'READY_WITH_ERRORS' : 'READY';
  await deps.cacheStore.finalizeRefresh(runId, outcome, now, failedCount > 0 ? { failedCount } : {});
  logger.info('Sport cache refresh completed', { runId, newCount, failedCount, durationMs: Date.now() - startedAt, outcome });
}

async function finalizeAsCutoff(cacheStore: SportCacheStore, runId: string, now: Date, startedAt: number): Promise<void> {
  logger.warn('Sport cache refresh reached its time cutoff', { runId });
  await cacheStore.finalizeRefresh(runId, 'FAILED', now, { failureReason: 'TIME_LIMIT_REACHED' });
  logger.info('Sport cache refresh failed', { runId, durationMs: Date.now() - startedAt, outcome: 'FAILED', failureReason: 'TIME_LIMIT_REACHED' });
}
