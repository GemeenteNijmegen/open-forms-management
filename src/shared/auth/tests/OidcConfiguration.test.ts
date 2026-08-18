import { AWS } from '@gemeentenijmegen/utils';
import { logger } from '../../../observability/Logger';
import { loadOidcConfiguration } from '../OidcConfiguration';

jest.mock('@gemeentenijmegen/utils', () => ({
  AWS: { getSecret: jest.fn() },
}));

describe('loadOidcConfiguration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    // These tests deliberately trigger error paths; suppress the resulting
    // logger.error output so test runs stay readable.
    jest.spyOn(logger, 'error').mockImplementation(() => { });
    process.env = {
      ...originalEnv,
      OIDC_ISSUER: 'https://login.microsoftonline.com/test-tenant/v2.0',
      OIDC_CLIENT_ID: 'test-client-id',
      OIDC_CLIENT_SECRET_ARN: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:oidc-client-secret',
      MANAGEMENT_DOMAIN: 'management.example.nl',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('reads non-secret configuration from environment variables and the secret from Secrets Manager', async () => {
    (AWS.getSecret as jest.Mock).mockResolvedValue('the-real-client-secret');

    const configuration = await loadOidcConfiguration();

    expect(AWS.getSecret).toHaveBeenCalledWith(process.env.OIDC_CLIENT_SECRET_ARN);
    expect(configuration).toEqual({
      issuer: 'https://login.microsoftonline.com/test-tenant/v2.0',
      clientId: 'test-client-id',
      redirectUrl: 'https://management.example.nl/auth/callback',
      clientSecret: 'the-real-client-secret',
    });
  });

  it.each(['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET_ARN', 'MANAGEMENT_DOMAIN'])(
    'throws a clear error when %s is missing',
    async (missingVar) => {
      delete process.env[missingVar];

      await expect(loadOidcConfiguration()).rejects.toThrow('OIDC configuration is incomplete');
      expect(AWS.getSecret).not.toHaveBeenCalled();
    },
  );
});
