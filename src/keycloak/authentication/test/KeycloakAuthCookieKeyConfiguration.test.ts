import { AWS } from '@gemeentenijmegen/utils';
import { loadKeycloakAuthCookieKey } from '../KeycloakAuthCookieKeyConfiguration';

jest.mock('@gemeentenijmegen/utils', () => ({
  ...jest.requireActual('@gemeentenijmegen/utils'),
  AWS: { getSecret: jest.fn() },
}));

const A_256_BIT_KEY = 'a'.repeat(43) + '=';

describe('loadKeycloakAuthCookieKey', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      KEYCLOAK_AUTH_COOKIE_KEY_SECRET_NAME: 'example-auth-cookie-key-secret-name',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // These run before the happy-path test below on purpose: a failed load resets the module cache
  // itself (see the .catch() in loadKeycloakAuthCookieKey), a successful one doesn't, so ordering
  // fail-closed cases first avoids needing any test-only cache reset in production code.
  it.each([
    ['a missing secret name env var', () => { delete process.env.KEYCLOAK_AUTH_COOKIE_KEY_SECRET_NAME; }],
    ['a key that is not a 256-bit base64 key', () => { (AWS.getSecret as jest.Mock).mockResolvedValue('too-short'); }],
  ])('fails closed for %s', async (_description, breakConfig) => {
    breakConfig();

    await expect(loadKeycloakAuthCookieKey()).rejects.toThrow();
  });

  it('reads the raw key value from Secrets Manager', async () => {
    (AWS.getSecret as jest.Mock).mockResolvedValue(A_256_BIT_KEY);

    const authCookieKey = await loadKeycloakAuthCookieKey();

    expect(AWS.getSecret).toHaveBeenCalledWith('example-auth-cookie-key-secret-name');
    expect(authCookieKey).toBe(A_256_BIT_KEY);
  });
});
