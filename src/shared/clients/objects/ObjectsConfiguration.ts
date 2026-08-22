import { AWS, environmentVariables } from '@gemeentenijmegen/utils';

export interface ObjectsClientConfiguration {
  /** Trusted as configured in SSM; must include the trailing `/`, e.g. `https://.../objects/api/v2/`. */
  baseUrl: string;
  apiToken: string;
}

let cachedConfiguration: Promise<ObjectsClientConfiguration> | undefined;

/**
 * Non-secret values come from Lambda environment variables, the API token
 * from Secrets Manager. Resolved once per warm module so a batch of
 * requests does not read the secret again.
 */
export async function loadObjectsConfiguration(): Promise<ObjectsClientConfiguration> {
  if (!cachedConfiguration) {
    cachedConfiguration = resolveObjectsConfiguration().catch((error) => {
      cachedConfiguration = undefined;
      throw error;
    });
  }
  return cachedConfiguration;
}

/** Test-only: clears the module-level config cache between test cases. */
export function resetObjectsConfigurationCache(): void {
  cachedConfiguration = undefined;
}

async function resolveObjectsConfiguration(): Promise<ObjectsClientConfiguration> {
  const env = environmentVariables(['OBJECTS_BASE_URL', 'OBJECTS_CREDENTIALS_SECRET_NAME'] as const);
  const secretValue = await AWS.getSecret(env.OBJECTS_CREDENTIALS_SECRET_NAME);
  const apiToken = parseApiToken(secretValue);

  return { baseUrl: env.OBJECTS_BASE_URL, apiToken };
}

function parseApiToken(secretValue: string): string {
  const { apiToken } = JSON.parse(secretValue);
  if (!apiToken) {
    throw new Error('Objects credentials secret is missing apiToken');
  }
  return apiToken;
}
