import { WoonbehoefteObjectData, woonbehoefteObjectDataSchema } from './WoonbehoefteObjectRecord';
import { WOONBEHOEFTE_PRIMARY_FORM_NAME } from './WoonbehoefteObjectsQuery';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { ObjectResource } from '../../../shared/clients/objects/ObjectsResponse';
import { OpenZaakClient } from '../../../shared/clients/open-zaak/OpenZaakClient';

const CONCURRENCY = 4;

export interface FetchedWoonbehoefteCsvDocument {
  objectUuid: string;
  objectData: WoonbehoefteObjectData;
  csvText: string;
}

export interface FailedWoonbehoefteDocument {
  objectUuid: string;
  reference?: string;
  failureReasonCode: string;
  /** Present for CSV_FETCH_ERROR only: the Object itself validated fine, only the CSV download failed, so there's still enough to create a minimal case. */
  objectData?: WoonbehoefteObjectData;
}

export interface WoonbehoefteCsvBatchResult {
  documents: FetchedWoonbehoefteCsvDocument[];
  failedDocuments: FailedWoonbehoefteDocument[];
}

/**
 * Fetches and validates the CSV document for every given Woonbehoefte Object, with the same small fixed
 * concurrency `fetchSportCsvDocuments` uses so a sync run can't blow past the worker's own time cutoff.
 * An object that fails shape validation or whose CSV can't be downloaded is skipped and reported, never
 * retried inline; the caller writes a FAILED marker so the next refresh retries just that one.
 */
export async function fetchWoonbehoefteCsvDocuments(
  client: OpenZaakClient,
  objects: ObjectResource[],
  actor: EmployeeIdentity,
): Promise<WoonbehoefteCsvBatchResult> {
  const startedAt = Date.now();
  logger.debug('Woonbehoefte CSV batch started', { documentCount: objects.length, concurrency: CONCURRENCY });

  const documents: FetchedWoonbehoefteCsvDocument[] = [];
  const failedDocuments: FailedWoonbehoefteDocument[] = [];
  let nextIndex = 0;

  async function fetchOne(documentIndex: number): Promise<void> {
    const object = objects[documentIndex];
    const objectUuid = object.uuid;
    if (!objectUuid) {
      logger.warn('Woonbehoefte object is missing a uuid, skipping', { documentIndex });
      return;
    }

    const parsedData = woonbehoefteObjectDataSchema.safeParse(object.record.data);
    if (!parsedData.success || parsedData.data.formName !== WOONBEHOEFTE_PRIMARY_FORM_NAME) {
      failedDocuments.push({ objectUuid, failureReasonCode: 'INVALID_OBJECT_SHAPE' });
      logger.warn('Woonbehoefte object failed shape validation, skipping', { objectUuid });
      return;
    }

    try {
      const csvText = await client.getDocumentText(parsedData.data.csv, actor);
      documents.push({ objectUuid, objectData: parsedData.data, csvText });
    } catch (error) {
      failedDocuments.push({ objectUuid, reference: parsedData.data.reference, failureReasonCode: 'CSV_FETCH_ERROR', objectData: parsedData.data });
      logger.warn('Woonbehoefte CSV document fetch failed', {
        objectUuid, reference: parsedData.data.reference, reason: errorReason(error),
      });
    }
  }

  async function worker(): Promise<void> {
    while (nextIndex < objects.length) {
      const documentIndex = nextIndex;
      nextIndex += 1;
      await fetchOne(documentIndex);
    }
  }

  const workerCount = Math.min(CONCURRENCY, objects.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  logger.debug('Woonbehoefte CSV batch finished', {
    documentCount: objects.length, succeededCount: documents.length, failedCount: failedDocuments.length, durationMs: Date.now() - startedAt,
  });

  return { documents, failedDocuments };
}
