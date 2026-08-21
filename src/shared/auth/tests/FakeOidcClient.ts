import { OidcAuthorizationResult, OidcClient } from '../OidcClient';

/**
 * In-memory OidcClient for injecting into tests of code that depends on
 * OidcClient (login/callback handlers), without talking to openid-client
 * or a real provider.
 */
export class FakeOidcClient implements OidcClient {
  authorizationUrl = 'https://fake-idp.example.com/authorize';
  authorizationResult: OidcAuthorizationResult = {
    claims: { sub: 'fake-subject' },
    scopes: ['openid', 'email'],
  };

  async getAuthorizationUrl(): Promise<string> {
    return this.authorizationUrl;
  }

  async exchangeAuthorizationCode(): Promise<OidcAuthorizationResult> {
    return this.authorizationResult;
  }

  generateState(): string {
    return 'fake-state';
  }

  generateNonce(): string {
    return 'fake-nonce';
  }
}
