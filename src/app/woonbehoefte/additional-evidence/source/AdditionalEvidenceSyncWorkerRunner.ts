import { parseAdditionalEvidenceCsv } from './AdditionalEvidenceCsvParser';
import { collectAdditionalEvidenceObjectsFrom } from './AdditionalEvidenceObjectsQuery';
import { AdditionalEvidenceSourceCacheStore } from './AdditionalEvidenceSourceCacheStore';
import { fetchAdditionalEvidenceCsvDocuments } from './fetchAdditionalEvidenceCsvDocuments';
import { errorReason } from '../../../../observability/errorReason';
import { logger } from '../../../../observability/Logger';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { ObjectsClient } from '../../../../shared/clients/objects/ObjectsClient';
import { ObjectResource } from '../../../../shared/clients/objects/ObjectsResponse';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { toDocumentReference, WoonbehoefteObjectData } from '../../source/WoonbehoefteObjectRecord';
import { ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION, AdditionalEvidenceSourceFailure, AdditionalEvidenceSourceItem, AdditionalEvidenceSourceRecord, isReadyAdditionalEvidenceSource } from '../domain/AdditionalEvidenceSource';
import { AdditionalEvidenceRepository, AdditionalEvidenceWorkItem } from '../persistence/AdditionalEvidenceRepository';

export interface AdditionalEvidenceSyncWorkerDependencies {
  objectsClient: ObjectsClient;
  openZaakClient: OpenZaakClient;
  sourceCacheStore: AdditionalEvidenceSourceCacheStore;
  repository: AdditionalEvidenceRepository;
}

// The worker calls Objects/Open Zaak on its own behalf, not on behalf of the medewerker whose refresh click triggered it.
const WORKER_ACTOR: EmployeeIdentity = { principalId: 'additional-evidence-sync-worker' };

function isKnownCacheHit(item: AdditionalEvidenceSourceItem): boolean {
  return item.status === 'READY' && item.cacheVersion === ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION;
}

/**
 * Checks the current Objects scope against the cache and processes only unknown/failed/outdated
 * objectUuid's, then (re)initializes a workitem for every currently READY submission so a workitem that
 * lost its init step on a previous run gets healed. `isPastCutoff` is checked between phases, the same
 * pragmatic granularity the primary Woonbehoefte worker uses. This never touches `WoonbehoefteCaseRepository`,
 * the primary `WoonbehoefteSourceCacheStore`, or `initializeCases()`/`initializeMinimalCase()`: an Additional
 * Evidence submission can only ever become an `AdditionalEvidenceWorkItem`, never a primary case.
 */
export async function runAdditionalEvidenceSyncRefresh(
  runId: string,
  deps: AdditionalEvidenceSyncWorkerDependencies,
  isPastCutoff: () => boolean,
  triggerCorrelationId: string,
): Promise<void> {
  const startedAt = Date.now();
  const state = await deps.sourceCacheStore.getState();
  if (state?.runId !== runId || state.status !== 'REFRESHING') {
    logger.debug('Additional Evidence sync worker skipped: runId is no longer the active refresh', { runId, triggerCorrelationId });
    return;
  }

  logger.info('Additional Evidence sync refresh started', { runId, triggerCorrelationId });
  const now = new Date();

  let objects: ObjectResource[];
  try {
    const objectsStartedAt = Date.now();
    objects = await collectAdditionalEvidenceObjectsFrom(deps.objectsClient);
    logger.debug('Additional Evidence objects scope resolved', { runId, objectsCount: objects.length, objectsDurationMs: Date.now() - objectsStartedAt });
  } catch (error) {
    logger.error('Additional Evidence sync refresh failed: Objects query failed', { runId, reason: errorReason(error) });
    await deps.sourceCacheStore.finalizeRefresh(runId, 'FAILED', now, { failureReason: 'OBJECTS_ERROR' });
    return;
  }

  const objectsByUuid = new Map(objects.filter((object) => object.uuid).map((object) => [object.uuid as string, object]));
  const cacheItems = await deps.sourceCacheStore.getItems([...objectsByUuid.keys()]);
  const objectsToFetch = [...objectsByUuid.values()].filter((object) => {
    const cached = cacheItems.get(object.uuid as string);
    return !cached || !isKnownCacheHit(cached);
  });

  const readyRecords: AdditionalEvidenceSourceRecord[] = [...cacheItems.values()].filter(isReadyAdditionalEvidenceSource).filter(isKnownCacheHit);

  logger.debug('Additional Evidence cache lookup finished', {
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
  // workitem, created together with the READY workitems below, gated by the same cutoff check.
  const minimalWorkItemCandidates: { objectUuid: string; objectData: WoonbehoefteObjectData }[] = [];

  if (objectsToFetch.length > 0) {
    const csvBatchStartedAt = Date.now();
    const fetchResult = await fetchAdditionalEvidenceCsvDocuments(deps.openZaakClient, objectsToFetch, WORKER_ACTOR);
    logger.debug('Additional Evidence CSV batch finished', { runId, csvBatchCount: objectsToFetch.length, csvFetchDurationMs: Date.now() - csvBatchStartedAt });

    for (const document of fetchResult.documents) {
      try {
        const parsed = parseAdditionalEvidenceCsv(document.csvText, document.objectData.reference);
        const record: AdditionalEvidenceSourceRecord = {
          status: 'READY',
          cacheVersion: ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION,
          objectUuid: document.objectUuid,
          submissionId: document.objectUuid,
          reference: document.objectData.reference,
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
        minimalWorkItemCandidates.push({ objectUuid: document.objectUuid, objectData: document.objectData });
        logger.warn('Additional Evidence submission failed to parse/validate', { runId, objectUuid: document.objectUuid, reason: errorReason(error) });
      }
    }

    for (const failedDocument of fetchResult.failedDocuments) {
      failedCount += 1;
      await putFailedMarker(
        deps.sourceCacheStore, failedDocument.objectUuid, failedDocument.reference, failedDocument.failureReasonCode, now, failedDocument.objectData,
      );
      if (failedDocument.objectData) {
        minimalWorkItemCandidates.push({ objectUuid: failedDocument.objectUuid, objectData: failedDocument.objectData });
      }
    }
  }

  if (isPastCutoff()) {
    await finalizeAsCutoff(deps.sourceCacheStore, runId, now, startedAt);
    return;
  }

  await initializeWorkItems(deps.repository, readyRecords, now, runId);
  for (const candidate of minimalWorkItemCandidates) {
    await initializeMinimalWorkItem(deps.repository, candidate.objectUuid, candidate.objectData, now, runId);
  }

  const outcome = failedCount > 0 ? 'READY_WITH_ERRORS' : 'READY';
  await deps.sourceCacheStore.finalizeRefresh(runId, outcome, now, failedCount > 0 ? { failedCount } : {});
  logger.info('Additional Evidence sync refresh completed', {
    runId, newCount: readyRecords.length, failedCount, durationMs: Date.now() - startedAt, outcome,
  });
}

async function putFailedMarker(
  store: AdditionalEvidenceSourceCacheStore, objectUuid: string, reference: string | undefined, failureReasonCode: string, now: Date,
  objectData?: WoonbehoefteObjectData,
): Promise<void> {
  const marker: AdditionalEvidenceSourceFailure = {
    status: 'FAILED',
    objectUuid,
    ...(reference ? { reference } : {}),
    failureReasonCode,
    lastAttemptAt: now.toISOString(),
    // The Object envelope is known/valid here (only the CSV itself failed), so the PDF/attachments it
    // already points at stay downloadable even though the submission is showing a bronfout.
    ...(objectData?.pdf ? { pdfDocument: toDocumentReference(objectData.pdf, 'APPLICATION_PDF') } : {}),
    ...(objectData?.attachments?.length ? { attachments: objectData.attachments.map((url) => toDocumentReference(url, 'ATTACHMENT')) } : {}),
  };
  await store.putFailed(marker);
}

/**
 * Re-runs workitem initialization for every currently READY record, including ones this run didn't
 * re-fetch: a workitem whose creation failed on a previous run (e.g. a mid-run cutoff) gets healed here
 * without ever overwriting a workitem a medewerker already moved to UNKNOWN/LINKED.
 */
async function initializeWorkItems(
  repository: AdditionalEvidenceRepository, records: AdditionalEvidenceSourceRecord[], now: Date, runId: string,
): Promise<void> {
  for (const record of records) {
    const workItem: AdditionalEvidenceWorkItem = {
      objectUuid: record.objectUuid,
      submissionReference: record.reference,
      status: 'NEW',
      originalCaseReference: record.originalCaseReference,
      submittedAt: record.submittedAt,
      ...(record.submittedProjectName ? { submittedProjectName: record.submittedProjectName } : {}),
      ...(record.contactEmail ? { contactEmail: record.contactEmail } : {}),
      ...(record.contactPhone ? { contactPhone: record.contactPhone } : {}),
      ...(record.evidenceDescription ? { evidenceDescription: record.evidenceDescription } : {}),
      ...(record.remarks ? { remarks: record.remarks } : {}),
      createdAt: now.toISOString(),
      createdBy: WORKER_ACTOR.principalId,
    };
    await repository.createWorkItemIfMissing(workItem);
    logger.debug('Additional Evidence workitem initialization attempted', { runId, objectUuid: record.objectUuid });
  }
}

/**
 * A workitem whose CSV could not be read still gets created, as long as the Object itself is known and
 * valid (uuid + own OF-reference). The detail page shows the source-error message from its FAILED source
 * marker; the medewerker never loses sight of the submission.
 */
async function initializeMinimalWorkItem(
  repository: AdditionalEvidenceRepository, objectUuid: string, objectData: WoonbehoefteObjectData, now: Date, runId: string,
): Promise<void> {
  await repository.createWorkItemIfMissing({
    objectUuid,
    submissionReference: objectData.reference,
    status: 'NEW',
    createdAt: now.toISOString(),
    createdBy: WORKER_ACTOR.principalId,
  });
  logger.debug('Additional Evidence minimal workitem initialization attempted (source-error)', { runId, objectUuid });
}

async function finalizeAsCutoff(store: AdditionalEvidenceSourceCacheStore, runId: string, now: Date, startedAt: number): Promise<void> {
  logger.warn('Additional Evidence sync refresh reached its time cutoff', { runId });
  await store.finalizeRefresh(runId, 'FAILED', now, { failureReason: 'TIME_LIMIT_REACHED' });
  logger.info('Additional Evidence sync refresh failed', { runId, durationMs: Date.now() - startedAt, outcome: 'FAILED', failureReason: 'TIME_LIMIT_REACHED' });
}
