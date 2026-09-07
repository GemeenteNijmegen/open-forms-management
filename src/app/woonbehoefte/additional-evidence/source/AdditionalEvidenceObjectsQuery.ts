import { logger } from '../../../../observability/Logger';
import { ObjectsClient } from '../../../../shared/clients/objects/ObjectsClient';
import { ObjectResource } from '../../../../shared/clients/objects/ObjectsResponse';

export const ADDITIONAL_EVIDENCE_FORM_NAME = 'Extra bewijzen stroomaansluiting woningbouw';

/** Collects every Additional Evidence Object. Same no-date-window reasoning as the primary Woonbehoefte query. */
export async function collectAdditionalEvidenceObjectsFrom(client: ObjectsClient): Promise<ObjectResource[]> {
  const startedAt = Date.now();

  const objects = await client.collectObjects({
    dataFilters: [{ path: ['formName'], operator: 'exact', value: ADDITIONAL_EVIDENCE_FORM_NAME }],
  });

  logger.debug('Additional Evidence objects query finished', { resultCount: objects.length, durationMs: Date.now() - startedAt });

  return objects;
}
