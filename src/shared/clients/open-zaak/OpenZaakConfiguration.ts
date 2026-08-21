import { AWS, environmentVariables } from '@gemeentenijmegen/utils';

export interface OpenZaakClientConfiguration {
  /** Trusted as configured in SSM; must include the trailing `/`, e.g. `https://.../documenten/api/v1/`. */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

let cachedConfiguration: Promise<OpenZaakClientConfiguration> | undefined;

/**
 * Non-secret values come from Lambda environment variables, `clientId`/
 * `clientSecret` from Secrets Manager. Resolved once per warm module so a
 * document batch does not read the secret again; JWTs are never cached.
 */
export async function loadOpenZaakConfiguration(): Promise<OpenZaakClientConfiguration> {
  if (!cachedConfiguration) {
    cachedConfiguration = resolveOpenZaakConfiguration().catch((error) => {
      cachedConfiguration = undefined;
      throw error;
    });
  }
  return cachedConfiguration;
}

/** Test-only: clears the module-level config cache between test cases. */
export function resetOpenZaakConfigurationCache(): void {
  cachedConfiguration = undefined;
}

async function resolveOpenZaakConfiguration(): Promise<OpenZaakClientConfiguration> {
  const env = environmentVariables(['OPEN_ZAAK_DOCUMENTEN_BASE_URL', 'OPEN_ZAAK_CREDENTIALS_SECRET_NAME'] as const);
  const secretValue = await AWS.getSecret(env.OPEN_ZAAK_CREDENTIALS_SECRET_NAME); // getSecret accepts secret name as well, not just arn
  const { clientId, clientSecret } = parseCredentials(secretValue);

  return { baseUrl: env.OPEN_ZAAK_DOCUMENTEN_BASE_URL, clientId, clientSecret };
}

function parseCredentials(secretValue: string): { clientId: string; clientSecret: string } {
  const { clientId, clientSecret } = JSON.parse(secretValue);
  if (!clientId || !clientSecret) {
    throw new Error('Open Zaak credentials secret is missing clientId/clientSecret');
  }
  return { clientId, clientSecret };
}
