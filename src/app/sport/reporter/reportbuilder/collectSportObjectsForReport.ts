import { logger } from '../../../../observability/Logger';
import { ObjectsClient } from '../../../../shared/clients/objects/ObjectsClient';
import { ObjectResource } from '../../../../shared/clients/objects/ObjectsResponse';
import { SPORT_FORM_NAME } from '../../SportObjectsQuery';

/**
 * Collects every Sportinzending Object registered in the requested range, newest first. Unlike
 * `collectSportObjects` (the `/sport` page, current season only), this takes an arbitrary historical
 * `from`/`to` and never reads the current-season cache. Ordering/early-stop come from `ObjectsClient`'s
 * own `registrationRange`, exactly like the page's query.
 */
export async function collectSportObjectsForReport(client: ObjectsClient, from: string, to: string): Promise<ObjectResource[]> {
  const startedAt = Date.now();

  const objects = await client.collectObjects(
    { dataFilters: [{ path: ['formName'], operator: 'exact', value: SPORT_FORM_NAME }] },
    { registrationRange: { from, to } },
  );

  logger.debug('Sport report objects query finished', { from, to, resultCount: objects.length, durationMs: Date.now() - startedAt });

  return objects;
}
