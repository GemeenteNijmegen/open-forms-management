import { createRemoteJWKSet, jwtVerify } from 'jose';
import { KeycloakAuthenticationConfiguration } from './KeycloakAuthenticationConfiguration';
import { KeycloakTokenClaims } from './KeycloakAuthenticationModels';
import { toKeycloakTokenClaims } from './KeycloakTokenClaimsMapper';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';

/**
 * Verifies a Keycloak access token's signature and claims against the realm's JWKS. The JWKS
 * resolver is cached in-memory (jose's own cooldown/max-age), so a caller should construct one per
 * warm Lambda execution environment rather than per request.
 */
export class KeycloakTokenVerifier {
  private getKey?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly settings: KeycloakAuthenticationConfiguration) { }

  async verifyAccessToken(accessToken: string): Promise<KeycloakTokenClaims> {
    const getKey = await this.resolveKey();

    let payload;
    try {
      ({ payload } = await jwtVerify(accessToken, getKey, {
        issuer: this.settings.issuer,
        audience: this.settings.oidcClient.clientId,
        algorithms: ['RS256'],
      }));
    } catch (error) {
      logger.error('Keycloak access token verification failed', { reason: errorReason(error) });
      throw error;
    }

    return toKeycloakTokenClaims(payload, this.settings.oidcClient.clientId);
  }

  private async resolveKey(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    if (!this.getKey) {
      const jwksUri = await this.discoverJwksUri();
      this.getKey = createRemoteJWKSet(new URL(jwksUri));
    }
    return this.getKey;
  }

  /**
   * The certs path is a Keycloak implementation detail, not part of the OIDC spec, and could change
   * between Keycloak versions. Reading jwks_uri from the discovery document avoids depending on it.
   */
  private async discoverJwksUri(): Promise<string> {
    const discoveryUrl = new URL(`${this.settings.issuer}/.well-known/openid-configuration`);
    logger.debug('Fetching Keycloak discovery metadata for JWKS', { issuer: this.settings.issuer });

    let response: Response;
    try {
      response = await fetch(discoveryUrl);
    } catch (error) {
      logger.error('Keycloak discovery failed', { issuer: this.settings.issuer, reason: errorReason(error) });
      throw error;
    }
    if (!response.ok) {
      logger.error('Keycloak discovery failed', { issuer: this.settings.issuer, httpStatus: response.status });
      throw new Error(`Keycloak discovery failed with status ${response.status}`);
    }

    const metadata: unknown = await response.json();
    const jwksUri = (metadata as Record<string, unknown>).jwks_uri;
    if (typeof jwksUri !== 'string') {
      throw new Error('Keycloak discovery metadata is missing jwks_uri');
    }
    return jwksUri;
  }
}
