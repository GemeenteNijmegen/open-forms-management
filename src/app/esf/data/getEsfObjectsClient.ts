import { AWS, environmentVariables } from '@gemeentenijmegen/utils';
import { logger } from '../../../observability/Logger';
import { ObjectsClient } from '../../../shared/clients/objects/ObjectsClient';

let cachedClient: Promise<ObjectsClient> | undefined;

// Eigen read-only token. Valt nooit terug op getObjectsClient(): dat token is van Sport en Woonbehoefte.
export async function getEsfObjectsClient(): Promise<ObjectsClient> {
  if (!cachedClient) {
    cachedClient = createEsfObjectsClient().catch((error) => {
      cachedClient = undefined;
      throw error;
    });
  }
  return cachedClient;
}

export function resetEsfObjectsClientCache(): void {
  cachedClient = undefined;
}

async function createEsfObjectsClient(): Promise<ObjectsClient> {
  const env = environmentVariables(['OBJECTS_BASE_URL', 'ESF_OBJECTS_CREDENTIALS_SECRET_NAME'] as const);
  const { apiToken } = JSON.parse(await AWS.getSecret(env.ESF_OBJECTS_CREDENTIALS_SECRET_NAME));
  if (!apiToken) {
    throw new Error('ESF Objects credentials secret is missing apiToken');
  }
  logger.info('ESF Objects client initialized');
  return new ObjectsClient({ baseUrl: env.OBJECTS_BASE_URL, apiToken });
}
