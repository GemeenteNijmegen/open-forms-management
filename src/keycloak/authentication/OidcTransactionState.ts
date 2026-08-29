/**
 * Short-lived state for one login attempt, from redirect to callback. Carried client-side (encrypted)
 * rather than server-side, so the callback can validate state/nonce/PKCE without session storage.
 */
export interface OidcTransactionState {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** Local OFM path to return to after login, e.g. /woonbehoefte/123. Never an absolute external URL. */
  returnUrl?: string;
  issuedAt: number;
  expiresAt: number;
}
