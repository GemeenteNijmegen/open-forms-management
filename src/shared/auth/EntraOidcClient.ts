import { randomUUID } from 'crypto';
import * as client from 'openid-client';
import { OidcAuthorizationResult, OidcClient } from './OidcClient';
import { logger } from '../../observability/Logger';

export interface EntraOidcClientConfiguration {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
}

/**
 * Microsoft Entra ID OIDC adapter. Discovery metadata is cached in-memory
 * for the lifetime of this Lambda execution environment; it is never
 * persisted anywhere else.
 */
export class EntraOidcClient implements OidcClient {
  private configuration?: client.Configuration;

  constructor(private readonly settings: EntraOidcClientConfiguration) { }

  async getAuthorizationUrl(state: string, nonce: string, scope: string): Promise<string> {
    logger.debug('Building OIDC authorization request', { scope });
    const configuration = await this.discover();
    const url = client.buildAuthorizationUrl(configuration, {
      redirect_uri: this.settings.redirectUrl,
      response_type: 'code',
      scope,
      state,
      nonce,
    });
    return url.toString();
  }

  async exchangeAuthorizationCode(callbackUrl: URL, expectedState: string, expectedNonce: string): Promise<OidcAuthorizationResult> {
    const configuration = await this.discover();

    logger.debug('Exchanging authorization code');
    let tokens;
    try {
      tokens = await client.authorizationCodeGrant(configuration, callbackUrl, {
        expectedState,
        expectedNonce,
      });
    } catch (error) {
      logger.error('Authorization code exchange failed', { reason: error instanceof Error ? error.message : String(error) });
      throw error;
    }

    const claims = tokens.claims();
    if (!claims) {
      logger.error('No ID token claims returned by idp');
      throw new Error('No ID token claims returned by idp');
    }
    logger.debug('ID token validated');

    return {
      claims: claims as OidcAuthorizationResult['claims'],
      scopes: tokens.scope ? tokens.scope.split(' ') : [],
    };
  }

  generateState(): string {
    return randomUUID();
  }

  generateNonce(): string {
    return randomUUID();
  }

  private async discover(): Promise<client.Configuration> {
    if (!this.configuration) {
      logger.debug('Fetching OIDC discovery metadata', { issuer: this.settings.issuer });
      try {
        this.configuration = await client.discovery(
          new URL(this.settings.issuer),
          this.settings.clientId,
          { client_secret: this.settings.clientSecret },
        );
      } catch (error) {
        logger.error('OIDC discovery failed', {
          issuer: this.settings.issuer,
          reason: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
    return this.configuration;
  }
}
