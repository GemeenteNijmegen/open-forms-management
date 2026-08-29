import { logger } from '../../../observability/Logger';
import { KeycloakOidcClient } from '../KeycloakOidcClient';

const mockDiscovery = jest.fn();
const mockBuildAuthorizationUrl = jest.fn();
const mockAuthorizationCodeGrant = jest.fn();
const mockRandomPKCECodeVerifier = jest.fn();
const mockCalculatePKCECodeChallenge = jest.fn();

jest.mock('openid-client', () => ({
  discovery: (...args: unknown[]) => mockDiscovery(...args),
  buildAuthorizationUrl: (...args: unknown[]) => mockBuildAuthorizationUrl(...args),
  authorizationCodeGrant: (...args: unknown[]) => mockAuthorizationCodeGrant(...args),
  randomPKCECodeVerifier: (...args: unknown[]) => mockRandomPKCECodeVerifier(...args),
  calculatePKCECodeChallenge: (...args: unknown[]) => mockCalculatePKCECodeChallenge(...args),
}));

describe('KeycloakOidcClient', () => {
  const settings = {
    baseUrl: 'https://keycloak.example.com/',
    issuer: 'https://keycloak.example.com/realms/example-realm',
    realm: 'example-realm',
    oidcClient: { clientId: 'open-forms-management', clientSecret: 'test-client-secret' },
  };
  const redirectUrl = 'https://management.example.com/auth/callback';

  const discoveredConfiguration = { fake: 'oidc-configuration' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDiscovery.mockResolvedValue(discoveredConfiguration);
    mockRandomPKCECodeVerifier.mockReturnValue('the-code-verifier');
    mockCalculatePKCECodeChallenge.mockResolvedValue('the-code-challenge');
    // Several tests below deliberately trigger error paths; suppress the resulting logger.error output.
    jest.spyOn(logger, 'error').mockImplementation(() => { });
  });

  it('builds an authorization request with PKCE S256, state, nonce and only the agreed scopes', async () => {
    mockBuildAuthorizationUrl.mockReturnValue(new URL('https://keycloak.example.com/realms/example-realm/protocol/openid-connect/auth?state=s'));

    const oidcClient = new KeycloakOidcClient(settings, redirectUrl);
    const result = await oidcClient.startAuthorization({ returnUrl: '/woonbehoefte/123' });

    expect(mockBuildAuthorizationUrl).toHaveBeenCalledWith(discoveredConfiguration, expect.objectContaining({
      redirect_uri: redirectUrl,
      response_type: 'code',
      scope: 'openid email',
      code_challenge: 'the-code-challenge',
      code_challenge_method: 'S256',
    }));
    const [, params] = mockBuildAuthorizationUrl.mock.calls[0];
    expect(params.state).toEqual(expect.any(String));
    expect(params.nonce).toEqual(expect.any(String));
    expect(result.transactionState).toEqual({
      state: params.state,
      nonce: params.nonce,
      codeVerifier: 'the-code-verifier',
      returnUrl: '/woonbehoefte/123',
      issuedAt: expect.any(Number),
      expiresAt: expect.any(Number),
    });
  });

  it('exchanges the code and returns the token model and verified claims', async () => {
    const callbackUrl = new URL('https://management.example.com/auth/callback?code=abc&state=the-state');
    mockAuthorizationCodeGrant.mockResolvedValue({
      access_token: 'the-access-token',
      refresh_token: 'the-refresh-token',
      id_token: 'the-id-token',
      expiresIn: () => 300,
      claims: () => ({
        iss: settings.issuer,
        sub: 'user-123',
        aud: 'open-forms-management',
        exp: 1893456000,
        email: 'medewerker@example.com',
        resource_access: { 'open-forms-management': { roles: ['sport:view', 'sport:district:all'] } },
      }),
    });

    const oidcClient = new KeycloakOidcClient(settings, redirectUrl);
    const result = await oidcClient.exchangeAuthorizationCode(callbackUrl, {
      state: 'the-state', nonce: 'the-nonce', codeVerifier: 'the-code-verifier', issuedAt: 0, expiresAt: 600,
    });

    expect(mockAuthorizationCodeGrant).toHaveBeenCalledWith(discoveredConfiguration, callbackUrl, {
      expectedState: 'the-state',
      expectedNonce: 'the-nonce',
      pkceCodeVerifier: 'the-code-verifier',
    });
    expect(result).toEqual({
      tokens: {
        accessToken: 'the-access-token',
        accessTokenExpiresAt: expect.any(Number),
        refreshToken: 'the-refresh-token',
        refreshTokenExpiresAt: undefined,
        idToken: 'the-id-token',
      },
      claims: {
        iss: settings.issuer,
        sub: 'user-123',
        aud: 'open-forms-management',
        exp: 1893456000,
        email: 'medewerker@example.com',
        roles: ['sport:view', 'sport:district:all'],
      },
    });
  });

  it('rejects a state/nonce mismatch from the library without leaking any token in the log', async () => {
    const errorSpy = jest.spyOn(logger, 'error');
    mockAuthorizationCodeGrant.mockRejectedValue(new Error('state mismatch'));
    const callbackUrl = new URL('https://management.example.com/auth/callback?code=abc&state=wrong-state');

    const oidcClient = new KeycloakOidcClient(settings, redirectUrl);

    await expect(oidcClient.exchangeAuthorizationCode(callbackUrl, {
      state: 'the-state', nonce: 'the-nonce', codeVerifier: 'the-code-verifier', issuedAt: 0, expiresAt: 600,
    })).rejects.toThrow('state mismatch');

    expect(errorSpy).toHaveBeenCalledWith('Keycloak authorization code exchange failed', { reason: 'state mismatch' });
    const loggedText = JSON.stringify(errorSpy.mock.calls);
    expect(loggedText).not.toContain('abc');
    expect(loggedText).not.toContain('the-code-verifier');
  });

  it('fails closed when the ID token has no email claim', async () => {
    const callbackUrl = new URL('https://management.example.com/auth/callback?code=abc&state=the-state');
    mockAuthorizationCodeGrant.mockResolvedValue({
      access_token: 'the-access-token',
      refresh_token: 'the-refresh-token',
      id_token: 'the-id-token',
      expiresIn: () => 300,
      claims: () => ({ iss: settings.issuer, sub: 'user-123', aud: 'open-forms-management', exp: 1893456000 }),
    });

    const oidcClient = new KeycloakOidcClient(settings, redirectUrl);

    await expect(oidcClient.exchangeAuthorizationCode(callbackUrl, {
      state: 'the-state', nonce: 'the-nonce', codeVerifier: 'the-code-verifier', issuedAt: 0, expiresAt: 600,
    })).rejects.toThrow('email claim');
  });
});
