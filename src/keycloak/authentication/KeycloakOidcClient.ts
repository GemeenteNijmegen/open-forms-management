import { randomUUID } from 'crypto';
import * as client from 'openid-client';
import { KeycloakAuthenticationConfiguration } from './KeycloakAuthenticationConfiguration';
import {
  KeycloakAuthorizationRequestInput, KeycloakAuthorizationRequestResult, KeycloakLogoutRequest,
  KeycloakRefreshResult, KeycloakTokenClaims, KeycloakTokens,
} from './KeycloakAuthenticationModels';
import { OidcTransactionState } from './OidcTransactionState';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';

const SCOPE = 'openid email';

// Generous enough for a slow manual login/MFA round trip, still short-lived per the security baseline.
const TRANSACTION_LIFETIME_SECONDS = 600;

export interface KeycloakAuthorizationCodeResult {
  tokens: KeycloakTokens;
  claims: KeycloakTokenClaims;
}

/**
 * Keycloak OIDC adapter: Authorization Code Flow with PKCE S256. Discovery metadata is cached
 * in-memory for the lifetime of this instance, so a caller should construct one per warm Lambda
 * execution environment rather than per request.
 */
export class KeycloakOidcClient {
  private configuration?: client.Configuration;

  constructor(private readonly settings: KeycloakAuthenticationConfiguration, private readonly redirectUrl: string) { }

  async startAuthorization(input: KeycloakAuthorizationRequestInput = {}): Promise<KeycloakAuthorizationRequestResult> {
    logger.debug('Building Keycloak authorization request');
    const configuration = await this.discover();

    const state = randomUUID();
    const nonce = randomUUID();
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

    const authorizationUrl = client.buildAuthorizationUrl(configuration, {
      redirect_uri: this.redirectUrl,
      response_type: 'code',
      scope: SCOPE,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const issuedAt = Math.floor(Date.now() / 1000);
    return {
      authorizationUrl: authorizationUrl.toString(),
      transactionState: {
        state,
        nonce,
        codeVerifier,
        returnUrl: input.returnUrl,
        issuedAt,
        expiresAt: issuedAt + TRANSACTION_LIFETIME_SECONDS,
      },
    };
  }

  async exchangeAuthorizationCode(callbackUrl: URL, transactionState: OidcTransactionState): Promise<KeycloakAuthorizationCodeResult> {
    const configuration = await this.discover();

    logger.debug('Exchanging Keycloak authorization code');
    let tokenResponse;
    try {
      tokenResponse = await client.authorizationCodeGrant(configuration, callbackUrl, {
        expectedState: transactionState.state,
        expectedNonce: transactionState.nonce,
        pkceCodeVerifier: transactionState.codeVerifier,
      });
    } catch (error) {
      logger.error('Keycloak authorization code exchange failed', { reason: errorReason(error) });
      throw error;
    }

    const idTokenClaims = tokenResponse.claims();
    if (!idTokenClaims) {
      logger.error('No ID token claims returned by Keycloak');
      throw new Error('No ID token claims returned by Keycloak');
    }

    logger.debug('Keycloak ID token validated');
    return {
      tokens: toKeycloakTokens(tokenResponse),
      claims: toKeycloakTokenClaims(idTokenClaims, this.settings.oidcClient.clientId),
    };
  }

  /**
   * Keycloak rotates refresh tokens by default, so a fresh refresh_token is expected on every
   * refresh; toKeycloakTokens() below fails closed when one is missing rather than silently reusing
   * the old value, which would risk continuing on a token Keycloak already considers spent.
   */
  async refreshTokens(refreshToken: string): Promise<KeycloakRefreshResult> {
    const configuration = await this.discover();

    logger.debug('Refreshing Keycloak tokens');
    let tokenResponse;
    try {
      tokenResponse = await client.refreshTokenGrant(configuration, refreshToken);
    } catch (error) {
      logger.error('Keycloak token refresh failed', { reason: errorReason(error) });
      throw error;
    }

    return toKeycloakTokens(tokenResponse);
  }

  async buildLogoutUrl(logoutRequest: KeycloakLogoutRequest): Promise<string> {
    const configuration = await this.discover();

    const url = client.buildEndSessionUrl(configuration, {
      id_token_hint: logoutRequest.idTokenHint,
      post_logout_redirect_uri: logoutRequest.postLogoutRedirectUri,
      ...(logoutRequest.state ? { state: logoutRequest.state } : {}),
    });
    return url.toString();
  }

  private async discover(): Promise<client.Configuration> {
    if (!this.configuration) {
      logger.debug('Fetching Keycloak discovery metadata', { issuer: this.settings.issuer });
      try {
        this.configuration = await client.discovery(
          new URL(this.settings.issuer),
          this.settings.oidcClient.clientId,
          { client_secret: this.settings.oidcClient.clientSecret },
        );
      } catch (error) {
        logger.error('Keycloak discovery failed', { issuer: this.settings.issuer, reason: errorReason(error) });
        throw error;
      }
    }
    return this.configuration;
  }
}

function toKeycloakTokens(tokenResponse: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers): KeycloakTokens {
  if (!tokenResponse.refresh_token) {
    throw new Error('Keycloak token response is missing a refresh_token');
  }
  if (!tokenResponse.id_token) {
    throw new Error('Keycloak token response is missing an id_token');
  }

  const accessTokenExpiresAt = Math.floor(Date.now() / 1000) + (tokenResponse.expiresIn() ?? 0);
  // Keycloak-specific extension field, not part of the OAuth 2.0 token response standard.
  const refreshExpiresIn = tokenResponse.refresh_expires_in;

  return {
    accessToken: tokenResponse.access_token,
    accessTokenExpiresAt,
    refreshToken: tokenResponse.refresh_token,
    refreshTokenExpiresAt: typeof refreshExpiresIn === 'number' ? Math.floor(Date.now() / 1000) + refreshExpiresIn : undefined,
    idToken: tokenResponse.id_token,
  };
}

function toKeycloakTokenClaims(idToken: client.IDToken, oidcClientId: string): KeycloakTokenClaims {
  if (typeof idToken.email !== 'string' || idToken.email.length === 0) {
    throw new Error('ID token is missing the email claim');
  }

  return {
    iss: idToken.iss,
    sub: idToken.sub,
    aud: idToken.aud,
    exp: idToken.exp,
    email: idToken.email,
    roles: extractRoles(idToken.resource_access, oidcClientId),
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
