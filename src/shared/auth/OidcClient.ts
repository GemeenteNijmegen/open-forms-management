export interface OidcClaims {
  sub: string;
  [claim: string]: unknown;
}

export interface OidcAuthorizationResult {
  claims: OidcClaims;
  scopes: string[];
}

/**
 * Server-side boundary for talking to the OIDC provider. Implementations
 * never write OIDC data (tokens, codes) to browser storage; that is the
 * caller's responsibility, and out of scope here.
 */
export interface OidcClient {
  /**
   * Builds the URL to redirect the browser to for login.
   */
  getAuthorizationUrl(state: string, nonce: string, scope: string): Promise<string>;

  /**
   * Exchanges the authorization code from the callback for validated ID
   * token claims. Issuer, audience, nonce and state are all validated here.
   */
  exchangeAuthorizationCode(callbackUrl: URL, expectedState: string, expectedNonce: string): Promise<OidcAuthorizationResult>;

  generateState(): string;
  generateNonce(): string;
}
