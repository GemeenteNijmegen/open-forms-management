import { currentSportSeasonStart } from './SportSeason';
import { logger } from '../../../observability/Logger';
import { ObjectsClient } from '../../../shared/clients/objects/ObjectsClient';
import { ObjectResource } from '../../../shared/clients/objects/ObjectsResponse';

export const SPORT_FORM_NAME = 'Aanmelden sportactiviteit';

/**
 * Collects every Sportinzending Object from the start of the current sportseizoen, newest first.
 * Ordering/early-stop come from `ObjectsClient`'s own `registrationRange`; this never reads
 * `seizoenData` from the CSV, since that form value doesn't reliably match the actual registration date.
 */
export async function collectSportObjects(client: ObjectsClient, now: Date = new Date()): Promise<ObjectResource[]> {
  const seasonStart = currentSportSeasonStart(now);
  const startedAt = Date.now();

  const objects = await client.collectObjects(
    { dataFilters: [{ path: ['formName'], operator: 'exact', value: SPORT_FORM_NAME }] },
    { registrationRange: { from: seasonStart } },
  );

  logger.debug('Sport objects query finished', {
    seasonStart,
    resultCount: objects.length,
    durationMs: Date.now() - startedAt,
  });

  return objects;
}
