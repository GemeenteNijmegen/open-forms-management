import { OpenZaakClient } from './OpenZaakClient';
import { loadOpenZaakConfiguration } from './OpenZaakConfiguration';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';

let cachedClient: Promise<OpenZaakClient> | undefined;

/**
 * Lets a handler get a ready-to-use OpenZaakClient from environment +
 * secret without wiring config/JWT/fetch itself. The client instance is
 * reused within a warm module; actor stays a per-call parameter so it never
 * gets baked into this shared instance.
 */
export async function getOpenZaakClient(): Promise<OpenZaakClient> {
  if (!cachedClient) {
    cachedClient = loadOpenZaakConfiguration()
      .then((configuration) => {
        logger.info('Open Zaak client initialized');
        return new OpenZaakClient(configuration);
      })
      .catch((error) => {
        cachedClient = undefined;
        logger.error('Failed to construct Open Zaak client', { reason: errorReason(error) });
        throw error;
      });
  }
  return cachedClient;
}

/** Test-only: clears the module-level client cache between test cases. */
export function resetOpenZaakClientCache(): void {
  cachedClient = undefined;
}
