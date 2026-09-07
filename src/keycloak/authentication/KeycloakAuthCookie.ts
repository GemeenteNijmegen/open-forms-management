import { KeycloakTokens } from './KeycloakAuthenticationModels';
import { decryptKeycloakCookie, encryptKeycloakCookie } from './KeycloakCookieCipher';

interface AuthCookieClaims {
  accessToken?: unknown;
  accessTokenExpiresAt?: unknown;
  refreshToken?: unknown;
  idToken?: unknown;
}

/**
 * The cookie envelope's own expiry follows the refresh token, since that is the longer-lived
 * credential; an access-token-only expiry would make the cookie unreadable long before the refresh
 * token is spent.
 */
export async function encryptKeycloakAuthCookie(tokens: KeycloakTokens): Promise<string> {
  if (!tokens.refreshTokenExpiresAt) {
    throw new Error('Cannot encrypt an auth cookie without a refresh token expiry');
  }

  return encryptKeycloakCookie(
    {
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
    },
    Math.floor(Date.now() / 1000),
    tokens.refreshTokenExpiresAt,
  );
}

export async function decryptKeycloakAuthCookie(jwe: string): Promise<KeycloakTokens> {
  const { claims, expiresAt } = await decryptKeycloakCookie<AuthCookieClaims>(jwe);

  if (typeof claims.accessToken !== 'string' || claims.accessToken.length === 0) {
    throw new Error('Keycloak auth cookie is missing the accessToken claim');
  }
  if (typeof claims.accessTokenExpiresAt !== 'number') {
    throw new Error('Keycloak auth cookie is missing the accessTokenExpiresAt claim');
  }
  if (typeof claims.refreshToken !== 'string' || claims.refreshToken.length === 0) {
    throw new Error('Keycloak auth cookie is missing the refreshToken claim');
  }
  if (typeof claims.idToken !== 'string' || claims.idToken.length === 0) {
    throw new Error('Keycloak auth cookie is missing the idToken claim');
  }

  return {
    accessToken: claims.accessToken,
    accessTokenExpiresAt: claims.accessTokenExpiresAt,
    refreshToken: claims.refreshToken,
    refreshTokenExpiresAt: expiresAt,
    idToken: claims.idToken,
  };
}
