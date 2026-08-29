import { AWS } from '@gemeentenijmegen/utils';
import { loadKeycloakPermissionAdministrationConfiguration } from '../KeycloakPermissionAdministrationConfiguration';

jest.mock('@gemeentenijmegen/utils', () => ({
  ...jest.requireActual('@gemeentenijmegen/utils'),
  AWS: { getSecret: jest.fn() },
}));

describe('loadKeycloakPermissionAdministrationConfiguration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      KEYCLOAK_BASE_URL: 'https://keycloak.example.com/',
      KEYCLOAK_ISSUER: 'https://keycloak.example.com/realms/example-realm',
      KEYCLOAK_REALM: 'example-realm',
      KEYCLOAK_PERMISSION_ADMIN_CLIENT_SECRET_NAME: 'example-permission-admin-client-secret-name',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // These run before the happy-path test below on purpose: a failed load resets the module cache
  // itself (see the .catch() in loadKeycloakPermissionAdministrationConfiguration), a successful one
  // doesn't, so ordering fail-closed cases first avoids needing any test-only cache reset in production code.
  it.each([
    ['a missing KEYCLOAK_BASE_URL', () => { delete process.env.KEYCLOAK_BASE_URL; }],
    ['a missing KEYCLOAK_PERMISSION_ADMIN_CLIENT_SECRET_NAME', () => { delete process.env.KEYCLOAK_PERMISSION_ADMIN_CLIENT_SECRET_NAME; }],
    ['a malformed permission-admin client secret', () => {
      (AWS.getSecret as jest.Mock).mockResolvedValue(JSON.stringify({ clientId: 'admin-client' }));
    }],
  ])('fails closed for %s', async (_description, breakConfig) => {
    breakConfig();

    await expect(loadKeycloakPermissionAdministrationConfiguration()).rejects.toThrow();
  });

  it('reads the base config from the environment and permission-admin client credentials from Secrets Manager', async () => {
    (AWS.getSecret as jest.Mock).mockResolvedValue(JSON.stringify({ clientId: 'admin-client', clientSecret: 'admin-secret' }));

    const configuration = await loadKeycloakPermissionAdministrationConfiguration();

    expect(AWS.getSecret).toHaveBeenCalledWith(process.env.KEYCLOAK_PERMISSION_ADMIN_CLIENT_SECRET_NAME);
    expect(configuration).toEqual({
      baseUrl: 'https://keycloak.example.com/',
      issuer: 'https://keycloak.example.com/realms/example-realm',
      realm: 'example-realm',
      permissionAdminClient: { clientId: 'admin-client', clientSecret: 'admin-secret' },
    });
  });
});
