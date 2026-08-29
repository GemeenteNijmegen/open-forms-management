import { OidcTransactionState } from './OidcTransactionState';

export interface KeycloakAuthorizationRequestInput {
  /** Local OFM path to return to after login. Never an absolute external URL. */
  returnUrl?: string;
}

export interface KeycloakAuthorizationRequestResult {
  authorizationUrl: string;
  transactionState: OidcTransactionState;
}

/**
 * Result of an authorization code exchange or a refresh. refreshToken and idToken are both present:
 * the client always requests the openid scope and the standard SSO-session-bound refresh token.
 */
export interface KeycloakTokens {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  refreshTokenExpiresAt?: number;
  idToken: string;
}

/** A refresh returns the same shape as a fresh code exchange: a complete new token set. */
export type KeycloakRefreshResult = KeycloakTokens;

/** Verified ID token claims OFM actually needs, not a full mapping of every Keycloak claim. */
export interface KeycloakTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  email: string;
  /** From resource_access[open-forms-management].roles. */
  roles: string[];
}

/** Input for building an OIDC RP-Initiated Logout redirect. No legacy direct token revocation. */
export interface KeycloakLogoutRequest {
  idTokenHint: string;
  postLogoutRedirectUri: string;
  state?: string;
}
