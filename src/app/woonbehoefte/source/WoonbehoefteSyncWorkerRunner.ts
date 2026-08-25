import { fetchWoonbehoefteCsvDocuments } from './fetchWoonbehoefteCsvDocuments';
import { parseWoonbehoefteCsv } from './WoonbehoefteCsvParser';
import { toDocumentReference, WoonbehoefteObjectData } from './WoonbehoefteObjectRecord';
import { collectWoonbehoefteObjectsFrom } from './WoonbehoefteObjectsQuery';
import { WoonbehoefteSourceCacheStore } from './WoonbehoefteSourceCacheStore';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { ObjectsClient } from '../../../shared/clients/objects/ObjectsClient';
import { ObjectResource } from '../../../shared/clients/objects/ObjectsResponse';
import { OpenZaakClient } from '../../../shared/clients/open-zaak/OpenZaakClient';
import { WoonbehoefteCaseRepository } from '../cases/WoonbehoefteCaseRepository';
import { isReadySource, WOONBEHOEFTE_SOURCE_CACHE_VERSION, WoonbehoefteSourceFailure, WoonbehoefteSourceItem, WoonbehoefteSourceRecord } from '../domain/WoonbehoefteSource';

export interface WoonbehoefteSyncWorkerDependencies {
  objectsClient: ObjectsClient;
  openZaakClient: OpenZaakClient;
  sourceCacheStore: WoonbehoefteSourceCacheStore;
  caseRepository: WoonbehoefteCaseRepository;
}

// The worker calls Objects/Open Zaak on its own behalf, not on behalf of the medewerker whose refresh click triggered it.
const WORKER_ACTOR: EmployeeIdentity = { principalId: 'woonbehoefte-sync-worker' };

function isKnownCacheHit(item: WoonbehoefteSourceItem): boolean {
  return item.status === 'READY' && item.cacheVersion === WOONBEHOEFTE_SOURCE_CACHE_VERSION;
}

/**
 * Checks the current Objects scope against the cache and processes only unknown/failed/outdated
 * objectUuid's, then (re)initializes a case/primary source-link for every currently READY submission so
 * a case that lost its init step on a previous run gets healed. `isPastCutoff` is checked between
 * phases, the same pragmatic granularity `runSportCacheRefresh` uses.
 */
export async function runWoonbehoefteSyncRefresh(
  runId: string,
  deps: WoonbehoefteSyncWorkerDependencies,
  isPastCutoff: () => boolean,
  triggerCorrelationId: string,
): Promise<void> {
  const startedAt = Date.now();
  const state = await deps.sourceCacheStore.getState();
  if (state?.runId !== runId || state.status !== 'REFRESHING') {
    logger.debug('Woonbehoefte sync worker skipped: runId is no longer the active refresh', { runId, triggerCorrelationId });
    return;
  }

  logger.info('Woonbehoefte sync refresh started', { runId, triggerCorrelationId });
  const now = new Date();

  let objects: ObjectResource[];
  try {
    const objectsStartedAt = Date.now();
    objects = await collectWoonbehoefteObjectsFrom(deps.objectsClient);
    logger.debug('Woonbehoefte objects scope resolved', { runId, objectsCount: objects.length, objectsDurationMs: Date.now() - objectsStartedAt });
  } catch (error) {
    logger.error('Woonbehoefte sync refresh failed: Objects query failed', { runId, reason: errorReason(error) });
    await deps.sourceCacheStore.finalizeRefresh(runId, 'FAILED', now, { failureReason: 'OBJECTS_ERROR' });
    return;
  }

  const objectsByUuid = new Map(objects.filter((object) => object.uuid).map((object) => [object.uuid as string, object]));
  const cacheItems = await deps.sourceCacheStore.getItems([...objectsByUuid.keys()]);
  const objectsToFetch = [...objectsByUuid.values()].filter((object) => {
    const cached = cacheItems.get(object.uuid as string);
    return !cached || !isKnownCacheHit(cached);
  });

  const readyRecords: WoonbehoefteSourceRecord[] = [...cacheItems.values()].filter(isReadySource).filter(isKnownCacheHit);

  logger.debug('Woonbehoefte cache lookup finished', {
    runId,
    objectsCount: objectsByUuid.size,
    cacheHitCount: objectsByUuid.size - objectsToFetch.length,
    cacheMissCount: objectsToFetch.length,
  });

  if (isPastCutoff()) {
    await finalizeAsCutoff(deps.sourceCacheStore, runId, now, startedAt);
    return;
  }

  let failedCount = 0;
  // Objects whose Object metadata is known/valid but whose CSV could not be read still get a minimal
  // case, created together with the READY cases below, gated by the same cutoff check.
  const minimalCaseCandidates: { objectUuid: string; objectData: WoonbehoefteObjectData }[] = [];

  if (objectsToFetch.length > 0) {
    const csvBatchStartedAt = Date.now();
    const fetchResult = await fetchWoonbehoefteCsvDocuments(deps.openZaakClient, objectsToFetch, WORKER_ACTOR);
    logger.debug('Woonbehoefte CSV batch finished', { runId, csvBatchCount: objectsToFetch.length, csvFetchDurationMs: Date.now() - csvBatchStartedAt });

    for (const document of fetchResult.documents) {
      try {
        const parsed = parseWoonbehoefteCsv(document.csvText, document.objectData.reference);
        const record: WoonbehoefteSourceRecord = {
          status: 'READY',
          cacheVersion: WOONBEHOEFTE_SOURCE_CACHE_VERSION,
          objectUuid: document.objectUuid,
          submissionId: document.objectUuid,
          submissionType: 'PRIMARY_APPLICATION',
          reference: document.objectData.reference,
          caseReference: document.objectData.reference,
          formName: document.objectData.formName,
          ...parsed,
          csvDocument: toDocumentReference(document.objectData.csv, 'CSV'),
          ...(document.objectData.pdf ? { pdfDocument: toDocumentReference(document.objectData.pdf, 'APPLICATION_PDF') } : {}),
          attachments: (document.objectData.attachments ?? []).map((url) => toDocumentReference(url, 'ATTACHMENT')),
          cachedAt: now.toISOString(),
        };
        await deps.sourceCacheStore.putReady(record);
        readyRecords.push(record);
      } catch (error) {
        failedCount += 1;
        await putFailedMarker(deps.sourceCacheStore, document.objectUuid, document.objectData.reference, 'CSV_PARSE_ERROR', now, document.objectData);
        minimalCaseCandidates.push({ objectUuid: document.objectUuid, objectData: document.objectData });
        logger.warn('Woonbehoefte submission failed to parse/validate', { runId, objectUuid: document.objectUuid, reason: errorReason(error) });
      }
    }

    for (const failedDocument of fetchResult.failedDocuments) {
      failedCount += 1;
      await putFailedMarker(
        deps.sourceCacheStore, failedDocument.objectUuid, failedDocument.reference, failedDocument.failureReasonCode, now, failedDocument.objectData,
      );
      if (failedDocument.objectData) {
        minimalCaseCandidates.push({ objectUuid: failedDocument.objectUuid, objectData: failedDocument.objectData });
      }
    }
  }

  if (isPastCutoff()) {
    await finalizeAsCutoff(deps.sourceCacheStore, runId, now, startedAt);
    return;
  }

  await initializeCases(deps.caseRepository, readyRecords, now, runId);
  for (const candidate of minimalCaseCandidates) {
    await initializeMinimalCase(deps.caseRepository, candidate.objectUuid, candidate.objectData, now, runId);
  }

  const outcome = failedCount > 0 ? 'READY_WITH_ERRORS' : 'READY';
  await deps.sourceCacheStore.finalizeRefresh(runId, outcome, now, failedCount > 0 ? { failedCount } : {});
  logger.info('Woonbehoefte sync refresh completed', {
    runId, newCount: readyRecords.length, failedCount, durationMs: Date.now() - startedAt, outcome,
  });
}

async function putFailedMarker(
  store: WoonbehoefteSourceCacheStore, objectUuid: string, reference: string | undefined, failureReasonCode: string, now: Date,
  objectData?: WoonbehoefteObjectData,
): Promise<void> {
  const marker: WoonbehoefteSourceFailure = {
    status: 'FAILED',
    objectUuid,
    ...(reference ? { reference } : {}),
    submissionType: 'PRIMARY_APPLICATION',
    failureReasonCode,
    lastAttemptAt: now.toISOString(),
    // The Object envelope is known/valid here (only the CSV itself failed), so the PDF/attachments it
    // already points at stay downloadable even though the case is showing a bronfout.
    ...(objectData?.pdf ? { pdfDocument: toDocumentReference(objectData.pdf, 'APPLICATION_PDF') } : {}),
    ...(objectData?.attachments?.length ? { attachments: objectData.attachments.map((url) => toDocumentReference(url, 'ATTACHMENT')) } : {}),
  };
  await store.putFailed(marker);
}

/**
 * Re-runs case/primary-link initialization for every currently READY record, including ones this run
 * didn't re-fetch: a case whose creation step failed on a previous run (e.g. a mid-run cutoff) gets
 * healed here without ever overwriting a case that already exists.
 */
async function initializeCases(
  caseRepository: WoonbehoefteCaseRepository, records: WoonbehoefteSourceRecord[], now: Date, runId: string,
): Promise<void> {
  for (const record of records) {
    await caseRepository.createCaseIfMissing(record.caseReference, WORKER_ACTOR.principalId, now);
    const result = await caseRepository.createPrimarySourceLinkIfMissing(record.caseReference, record.submissionId, record.reference, now);
    if (result === 'CONFLICT') {
      logger.error('Woonbehoefte primary source link conflict: case already links a different submission', {
        runId, caseReference: record.caseReference, submissionId: record.submissionId,
      });
    }
  }
}

/**
 * A case whose primary source could not be read (corrupt CSV or a failed download) still gets created,
 * as long as the Object itself is known and valid (uuid + OF-reference). The detail page shows the
 * source-error message from its FAILED source marker; the medewerker never loses sight of the aanvraag.
 */
async function initializeMinimalCase(
  caseRepository: WoonbehoefteCaseRepository, objectUuid: string, objectData: WoonbehoefteObjectData, now: Date, runId: string,
): Promise<void> {
  await caseRepository.createCaseIfMissing(objectData.reference, WORKER_ACTOR.principalId, now);
  const result = await caseRepository.createPrimarySourceLinkIfMissing(objectData.reference, objectUuid, objectData.reference, now);
  if (result === 'CONFLICT') {
    logger.error('Woonbehoefte primary source link conflict on a minimal (source-error) case', {
      runId, caseReference: objectData.reference, submissionId: objectUuid,
    });
  }
}

async function finalizeAsCutoff(store: WoonbehoefteSourceCacheStore, runId: string, now: Date, startedAt: number): Promise<void> {
  logger.warn('Woonbehoefte sync refresh reached its time cutoff', { runId });
  await store.finalizeRefresh(runId, 'FAILED', now, { failureReason: 'TIME_LIMIT_REACHED' });
  logger.info('Woonbehoefte sync refresh failed', { runId, durationMs: Date.now() - startedAt, outcome: 'FAILED', failureReason: 'TIME_LIMIT_REACHED' });
}
