import { OidcClaims } from './OidcClient';

export interface EmployeeIdentity {
  principalId: string;
  email?: string;
}

/**
 * principalId is the ID token's `sub` claim. The broker's `oid`/`tid`
 * claims would be preferable for cross-application stability, but
 * requesting `profile` scope to obtain them currently breaks eID lookups
 * on the broker side.
 */
export function mapToEmployeeIdentity(claims: OidcClaims): EmployeeIdentity {
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new Error('ID token is missing the sub claim');
  }

  return {
    principalId: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
  };
}
