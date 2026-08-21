import { ObjectsClient } from './ObjectsClient';
import { loadObjectsConfiguration } from './ObjectsConfiguration';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';

let cachedClient: Promise<ObjectsClient> | undefined;

/** Lets a handler get a ready-to-use ObjectsClient from environment + secret without wiring config/auth itself. Reused within a warm module. */
export async function getObjectsClient(): Promise<ObjectsClient> {
  if (!cachedClient) {
    cachedClient = loadObjectsConfiguration()
      .then((configuration) => {
        logger.info('Objects client initialized');
        return new ObjectsClient(configuration);
      })
      .catch((error) => {
        cachedClient = undefined;
        logger.error('Failed to construct Objects client', { reason: errorReason(error) });
        throw error;
      });
  }
  return cachedClient;
}

/** Test-only: clears the module-level client cache between test cases. */
export function resetObjectsClientCache(): void {
  cachedClient = undefined;
}
