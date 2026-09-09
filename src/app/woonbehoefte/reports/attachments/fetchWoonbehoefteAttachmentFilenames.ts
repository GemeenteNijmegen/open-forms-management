import { errorReason } from '../../../../observability/errorReason';
import { logger } from '../../../../observability/Logger';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { SourceDocumentReference } from '../../domain/WoonbehoefteSource';

const CONCURRENCY = 4;

/**
 * Resolves bestandsnaam for every unique attachment (deduplicated by documentId), through the same small
 * fixed concurrency pool fetchWoonbehoefteRawFormFields/fetchWoonbehoefteCsvDocuments use. A documentId
 * missing from the result map failed to resolve, or its metadata had no bestandsnaam; the caller turns
 * that into a Bronwaarschuwing. This never throws.
 */
export async function fetchWoonbehoefteAttachmentFilenames(
  client: OpenZaakClient, references: SourceDocumentReference[], actor: EmployeeIdentity,
): Promise<Map<string, string>> {
  const uniqueReferences = [...new Map(references.map((reference) => [reference.documentId, reference])).values()];
  const result = new Map<string, string>();
  let nextIndex = 0;

  async function fetchOne(index: number): Promise<void> {
    const reference = uniqueReferences[index];
    try {
      const metadata = await client.getDocumentMetadata(reference.url, actor);
      if (metadata.bestandsnaam) {
        result.set(reference.documentId, metadata.bestandsnaam);
      } else {
        logger.warn('Woonbehoefte attachment metadata had no bestandsnaam', { documentId: reference.documentId });
      }
    } catch (error) {
      logger.warn('Woonbehoefte attachment metadata fetch failed', { documentId: reference.documentId, reason: errorReason(error) });
    }
  }

  async function worker(): Promise<void> {
    while (nextIndex < uniqueReferences.length) {
      const index = nextIndex;
      nextIndex += 1;
      await fetchOne(index);
    }
  }

  const workerCount = Math.min(CONCURRENCY, uniqueReferences.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return result;
}
