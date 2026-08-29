import { KeycloakTokenClaims } from './KeycloakAuthenticationModels';

interface RawKeycloakJwtPayload {
  iss?: unknown;
  sub?: unknown;
  aud?: unknown;
  exp?: unknown;
  email?: unknown;
  resource_access?: unknown;
}

/**
 * Shared by the OIDC client's ID token claims and the token verifier's access token claims: both are
 * Keycloak JWTs with the same shape for what OFM needs.
 */
export function toKeycloakTokenClaims(payload: RawKeycloakJwtPayload, oidcClientId: string): KeycloakTokenClaims {
  if (typeof payload.iss !== 'string') {
    throw new Error('Token is missing the iss claim');
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('Token is missing the sub claim');
  }
  if (typeof payload.aud !== 'string' && !Array.isArray(payload.aud)) {
    throw new Error('Token is missing the aud claim');
  }
  if (typeof payload.exp !== 'number') {
    throw new Error('Token is missing the exp claim');
  }
  if (typeof payload.email !== 'string' || payload.email.length === 0) {
    throw new Error('Token is missing the email claim');
  }

  return {
    iss: payload.iss,
    sub: payload.sub,
    aud: payload.aud as string | string[],
    exp: payload.exp,
    email: payload.email,
    roles: extractRoles(payload.resource_access, oidcClientId),
  };
}

function extractRoles(resourceAccess: unknown, oidcClientId: string): string[] {
  if (typeof resourceAccess !== 'object' || resourceAccess === null) {
    return [];
  }
  const entry = (resourceAccess as Record<string, unknown>)[oidcClientId];
  if (typeof entry !== 'object' || entry === null) {
    return [];
  }
  const roles = (entry as Record<string, unknown>).roles;
  return Array.isArray(roles) ? roles.filter((role): role is string => typeof role === 'string') : [];
}
