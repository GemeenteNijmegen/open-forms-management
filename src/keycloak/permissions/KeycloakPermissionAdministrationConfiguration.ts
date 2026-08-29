import { AWS, environmentVariables } from '@gemeentenijmegen/utils';
import { KeycloakBaseConfiguration, KeycloakClientCredentials, parseKeycloakClientCredentials } from '../shared/KeycloakConfiguration';

export interface KeycloakPermissionAdministrationConfiguration extends KeycloakBaseConfiguration {
  permissionAdminClient: KeycloakClientCredentials;
}

let cachedConfiguration: Promise<KeycloakPermissionAdministrationConfiguration> | undefined;

/**
 * Cached so repeated invocations on the same warm Lambda container reuse the already-fetched
 * credentials instead of calling Secrets Manager again every time.
 */
export async function loadKeycloakPermissionAdministrationConfiguration(): Promise<KeycloakPermissionAdministrationConfiguration> {
  if (!cachedConfiguration) {
    cachedConfiguration = resolveKeycloakPermissionAdministrationConfiguration().catch((error) => {
      cachedConfiguration = undefined;
      throw error;
    });
  }
  return cachedConfiguration;
}

async function resolveKeycloakPermissionAdministrationConfiguration(): Promise<KeycloakPermissionAdministrationConfiguration> {
  const env = environmentVariables([
    'KEYCLOAK_BASE_URL', 'KEYCLOAK_ISSUER', 'KEYCLOAK_REALM', 'KEYCLOAK_PERMISSION_ADMIN_CLIENT_SECRET_NAME',
  ] as const);
  const secretValue = await AWS.getSecret(env.KEYCLOAK_PERMISSION_ADMIN_CLIENT_SECRET_NAME);
  const permissionAdminClient = parseKeycloakClientCredentials(secretValue, 'Keycloak permission-admin client');

  return {
    baseUrl: env.KEYCLOAK_BASE_URL,
    issuer: env.KEYCLOAK_ISSUER,
    realm: env.KEYCLOAK_REALM,
    permissionAdminClient,
  };
}
