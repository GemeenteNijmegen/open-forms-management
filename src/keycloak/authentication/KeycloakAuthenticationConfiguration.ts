import { AWS, environmentVariables } from '@gemeentenijmegen/utils';
import { KeycloakBaseConfiguration, KeycloakClientCredentials, parseKeycloakClientCredentials } from '../shared/KeycloakConfiguration';

export interface KeycloakAuthenticationConfiguration extends KeycloakBaseConfiguration {
  oidcClient: KeycloakClientCredentials;
}

let cachedConfiguration: Promise<KeycloakAuthenticationConfiguration> | undefined;

// Cached so repeated invocations on the same warm Lambda container reuse the already-fetched
// credentials instead of calling Secrets Manager again every time.
export async function loadKeycloakAuthenticationConfiguration(): Promise<KeycloakAuthenticationConfiguration> {
  if (!cachedConfiguration) {
    cachedConfiguration = resolveKeycloakAuthenticationConfiguration().catch((error) => {
      cachedConfiguration = undefined;
      throw error;
    });
  }
  return cachedConfiguration;
}

async function resolveKeycloakAuthenticationConfiguration(): Promise<KeycloakAuthenticationConfiguration> {
  const env = environmentVariables([
    'KEYCLOAK_BASE_URL', 'KEYCLOAK_ISSUER', 'KEYCLOAK_REALM', 'KEYCLOAK_OIDC_CLIENT_SECRET_NAME',
  ] as const);
  const secretValue = await AWS.getSecret(env.KEYCLOAK_OIDC_CLIENT_SECRET_NAME);
  const oidcClient = parseKeycloakClientCredentials(secretValue, 'Keycloak OIDC client');

  return {
    baseUrl: env.KEYCLOAK_BASE_URL,
    issuer: env.KEYCLOAK_ISSUER,
    realm: env.KEYCLOAK_REALM,
    oidcClient,
  };
}
