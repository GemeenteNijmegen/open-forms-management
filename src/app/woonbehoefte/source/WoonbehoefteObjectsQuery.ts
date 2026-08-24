import { logger } from '../../../observability/Logger';
import { ObjectsClient } from '../../../shared/clients/objects/ObjectsClient';
import { ObjectResource } from '../../../shared/clients/objects/ObjectsResponse';

export const WOONBEHOEFTE_PRIMARY_FORM_NAME = 'Aanmelden stroomaansluiting woningbouw';

/**
 * Collects every primary Woonbehoefte Object. No date window: a few hundred rows over a few weeks is
 * small enough that a fixed campaign cutoff would only add a hardcoded date to maintain.
 */
export async function collectWoonbehoefteObjectsFrom(client: ObjectsClient): Promise<ObjectResource[]> {
  const startedAt = Date.now();

  const objects = await client.collectObjects({
    dataFilters: [{ path: ['formName'], operator: 'exact', value: WOONBEHOEFTE_PRIMARY_FORM_NAME }],
  });

  logger.debug('Woonbehoefte objects query finished', { resultCount: objects.length, durationMs: Date.now() - startedAt });

  return objects;
}
