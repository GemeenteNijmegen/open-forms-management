import { logger } from '../../../observability/Logger';
import { ObjectsClient } from '../../../shared/clients/objects/ObjectsClient';
import { ObjectResource } from '../../../shared/clients/objects/ObjectsResponse';

export const SPORT_FORM_NAME = 'Aanmelden sportactiviteit';

/**
 * Collects every Sportinzending Object registered from `from` onward, newest first. Ordering/early-stop
 * come from `ObjectsClient`'s own `registrationRange`; this never reads `seizoenData` from the CSV, since
 * that form value doesn't reliably match the actual registration date.
 */
export async function collectSportObjectsFrom(client: ObjectsClient, from: string): Promise<ObjectResource[]> {
  const startedAt = Date.now();

  const objects = await client.collectObjects(
    { dataFilters: [{ path: ['formName'], operator: 'exact', value: SPORT_FORM_NAME }] },
    { registrationRange: { from } },
  );

  logger.debug('Sport objects query finished', {
    from,
    resultCount: objects.length,
    durationMs: Date.now() - startedAt,
  });

  return objects;
}
