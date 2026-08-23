import { z } from 'zod';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { ObjectResource } from '../../../shared/clients/objects/ObjectsResponse';
import { OpenZaakClient } from '../../../shared/clients/open-zaak/OpenZaakClient';

const CONCURRENCY = 4;

const sportObjectDataSchema = z.looseObject({ reference: z.string(), csv: z.string(), pdf: z.string().optional() });

export interface FetchedSportCsvDocument {
  reference: string;
  csvText: string;
  objectUuid?: string;
  documentUrl?: string;
  /** Whether the Object had a `pdf` reference; the URL itself never leaves this fetch step. */
  hasPdf: boolean;
}

// Wat we van een mislukt document nog wél weten, voor de kleine waarschuwing op de Sportpagina: het
// OF-nummer (kenmerk) staat er alleen bij als het object zelf tenminste geldig genoeg was om te
// weten welke inzending het is; het objectnummer is er vrijwel altijd, ook als de rest onbruikbaar was.
export interface FailedSportDocument {
  reference?: string;
  objectUuid?: string;
}

export interface SportCsvBatchResult {
  documents: FetchedSportCsvDocument[];
  failedCount: number;
  failedDocuments: FailedSportDocument[];
}

/**
 * Fetches the CSV document for every Sport Object with a small fixed concurrency: the synchronous
 * Sport request can't fetch documents one at a time, or all at once, without risking the Lambda
 * timeout. A document that fails to validate or download is skipped and counted, not retried; the
 * caller shows a partial-result warning instead of failing the whole page.
 */
export async function fetchSportCsvDocuments(
  client: OpenZaakClient,
  objects: ObjectResource[],
  actor: EmployeeIdentity,
): Promise<SportCsvBatchResult> {
  const startedAt = Date.now();
  logger.debug('Sport CSV batch started', { documentCount: objects.length, concurrency: CONCURRENCY });

  const documents: FetchedSportCsvDocument[] = [];
  const failedDocuments: FailedSportDocument[] = [];
  let failedCount = 0;
  let nextIndex = 0;

  async function fetchOne(documentIndex: number): Promise<void> {
    const object = objects[documentIndex];
    const startedDocumentAt = Date.now();

    const parsedData = sportObjectDataSchema.safeParse(object.record.data);
    if (!parsedData.success) {
      failedCount += 1;
      failedDocuments.push({ objectUuid: object.uuid });
      logger.warn('Sport object is missing reference/csv, skipping', { documentIndex, objectUuid: object.uuid });
      return;
    }

    try {
      const csvText = await client.getDocumentText(parsedData.data.csv, actor);
      documents.push({
        reference: parsedData.data.reference,
        csvText,
        objectUuid: object.uuid,
        documentUrl: parsedData.data.csv,
        hasPdf: Boolean(parsedData.data.pdf),
      });
      logger.debug('Sport CSV document fetched', {
        documentIndex, durationMs: Date.now() - startedDocumentAt, outcome: 'success',
      });
    } catch (error) {
      failedCount += 1;
      failedDocuments.push({ reference: parsedData.data.reference, objectUuid: object.uuid });
      logger.warn('Sport CSV document fetch failed', {
        reference: parsedData.data.reference,
        objectUuid: object.uuid,
        durationMs: Date.now() - startedDocumentAt,
        outcome: 'failure',
        reason: errorReason(error),
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

  logger.debug('Sport CSV batch finished', {
    documentCount: objects.length,
    succeededCount: documents.length,
    failedCount,
    durationMs: Date.now() - startedAt,
  });

  return { documents, failedCount, failedDocuments };
}
