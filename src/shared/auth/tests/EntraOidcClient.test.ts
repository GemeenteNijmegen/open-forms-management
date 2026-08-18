import { logger } from '../../../observability/Logger';
import { EntraOidcClient } from '../EntraOidcClient';

const mockDiscovery = jest.fn();
const mockBuildAuthorizationUrl = jest.fn();
const mockAuthorizationCodeGrant = jest.fn();

jest.mock('openid-client', () => ({
  discovery: (...args: unknown[]) => mockDiscovery(...args),
  buildAuthorizationUrl: (...args: unknown[]) => mockBuildAuthorizationUrl(...args),
  authorizationCodeGrant: (...args: unknown[]) => mockAuthorizationCodeGrant(...args),
}));

describe('EntraOidcClient', () => {
  const settings = {
    issuer: 'https://login.microsoftonline.com/test-tenant/v2.0',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUrl: 'https://management.example.nl/auth/callback',
  };

  const discoveredConfiguration = { fake: 'oidc-configuration' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDiscovery.mockResolvedValue(discoveredConfiguration);
    // Several tests below deliberately trigger error paths; suppress the
    // resulting logger.error output so test runs stay readable.
    jest.spyOn(logger, 'error').mockImplementation(() => { });
  });

  describe('getAuthorizationUrl', () => {
    it('discovers metadata and builds the authorization url with state, nonce and scope', async () => {
      const mockUrl = new URL('https://login.microsoftonline.com/test-tenant/authorize?state=s');
      mockBuildAuthorizationUrl.mockReturnValue(mockUrl);

      const client = new EntraOidcClient(settings);
      const result = await client.getAuthorizationUrl('the-state', 'the-nonce', 'openid email');

      expect(mockDiscovery).toHaveBeenCalledWith(
        new URL(settings.issuer),
        settings.clientId,
        { client_secret: settings.clientSecret },
      );
      expect(mockBuildAuthorizationUrl).toHaveBeenCalledWith(discoveredConfiguration, {
        redirect_uri: settings.redirectUrl,
        response_type: 'code',
        scope: 'openid email',
        state: 'the-state',
        nonce: 'the-nonce',
      });
      expect(result).toBe(mockUrl.toString());
    });

    it('caches discovery metadata within the execution environment', async () => {
      mockBuildAuthorizationUrl.mockReturnValue(new URL('https://login.microsoftonline.com/authorize'));

      const client = new EntraOidcClient(settings);
      await client.getAuthorizationUrl('s1', 'n1', 'openid email');
      await client.getAuthorizationUrl('s2', 'n2', 'openid email');

      expect(mockDiscovery).toHaveBeenCalledTimes(1);
    });

    it('logs and propagates a discovery failure, e.g. a wrong issuer url or tenant', async () => {
      const errorSpy = jest.spyOn(logger, 'error');
      mockDiscovery.mockRejectedValue(new Error('invalid_issuer'));

      const client = new EntraOidcClient(settings);

      await expect(client.getAuthorizationUrl('the-state', 'the-nonce', 'openid email'))
        .rejects.toThrow('invalid_issuer');
      expect(errorSpy).toHaveBeenCalledWith('OIDC discovery failed', {
        issuer: settings.issuer,
        reason: 'invalid_issuer',
      });
    });
  });

  describe('exchangeAuthorizationCode', () => {
    const callbackUrl = new URL('https://management.example.nl/auth/callback?code=abc&state=the-state');

    it('exchanges the code and returns validated claims and scopes', async () => {
      mockAuthorizationCodeGrant.mockResolvedValue({
        scope: 'openid email',
        claims: () => ({ sub: 'employee-123', email: 'medewerker@nijmegen.nl' }),
      });

      const client = new EntraOidcClient(settings);
      const result = await client.exchangeAuthorizationCode(callbackUrl, 'the-state', 'the-nonce');

      expect(mockAuthorizationCodeGrant).toHaveBeenCalledWith(discoveredConfiguration, callbackUrl, {
        expectedState: 'the-state',
        expectedNonce: 'the-nonce',
      });
      expect(result).toEqual({
        claims: { sub: 'employee-123', email: 'medewerker@nijmegen.nl' },
        scopes: ['openid', 'email'],
      });
    });

    it('throws when the idp returns no ID token claims', async () => {
      mockAuthorizationCodeGrant.mockResolvedValue({
        scope: 'openid email',
        claims: () => undefined,
      });

      const client = new EntraOidcClient(settings);

      await expect(client.exchangeAuthorizationCode(callbackUrl, 'the-state', 'the-nonce'))
        .rejects.toThrow('No ID token claims returned by idp');
    });

    it('logs and propagates a state mismatch rejected by the library', async () => {
      const errorSpy = jest.spyOn(logger, 'error');
      mockAuthorizationCodeGrant.mockRejectedValue(new Error('state mismatch'));

      const client = new EntraOidcClient(settings);

      await expect(client.exchangeAuthorizationCode(callbackUrl, 'wrong-state', 'the-nonce'))
        .rejects.toThrow('state mismatch');
      expect(errorSpy).toHaveBeenCalledWith('Authorization code exchange failed', { reason: 'state mismatch' });
    });

    it('propagates a nonce mismatch rejected by the library', async () => {
      mockAuthorizationCodeGrant.mockRejectedValue(new Error('unexpected nonce'));

      const client = new EntraOidcClient(settings);

      await expect(client.exchangeAuthorizationCode(callbackUrl, 'the-state', 'wrong-nonce'))
        .rejects.toThrow('unexpected nonce');

      expect(mockAuthorizationCodeGrant).toHaveBeenCalledWith(discoveredConfiguration, callbackUrl, {
        expectedState: 'the-state',
        expectedNonce: 'wrong-nonce',
      });
    });

    it('propagates an issuer/audience validation failure rejected by the library', async () => {
      mockAuthorizationCodeGrant.mockRejectedValue(new Error('unexpected iss/aud value'));

      const client = new EntraOidcClient(settings);

      await expect(client.exchangeAuthorizationCode(callbackUrl, 'the-state', 'the-nonce'))
        .rejects.toThrow('unexpected iss/aud value');
    });
  });

  describe('generateState / generateNonce', () => {
    it('generate different UUIDs', () => {
      const client = new EntraOidcClient(settings);
      const state = client.generateState();
      const nonce = client.generateNonce();

      expect(state).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(state).not.toBe(nonce);
    });
  });
});
