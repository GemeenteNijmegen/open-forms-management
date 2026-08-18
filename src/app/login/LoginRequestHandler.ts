import { randomUUID } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { Session } from '@gemeentenijmegen/session';
import { logger } from '../../observability/Logger';
import { OidcClient } from '../../shared/auth/OidcClient';

const OIDC_SCOPE = 'openid email';

export class LoginRequestHandler {
  constructor(private readonly oidcClient: OidcClient) { }

  async handleRequest(cookieHeader: string | undefined, dynamoDBClient: DynamoDBClient): Promise<ApiGatewayV2Response> {
    const session = new Session(cookieHeader ?? '', dynamoDBClient);
    await session.init();

    if (session.isLoggedIn()) {
      logger.info('Already logged in, redirecting to home');
      return Response.redirect('/');
    }

    const state = this.oidcClient.generateState();
    const nonce = this.oidcClient.generateNonce();
    const flowId = randomUUID();
    logger.debug('Generated server-side login state', { flowId });

    await session.createSession({
      loggedin: { BOOL: false },
      state: { S: state },
      nonce: { S: nonce },
      flowId: { S: flowId },
    });

    logger.debug('Building OIDC authorization request', { flowId });
    const authorizationUrl = await this.oidcClient.getAuthorizationUrl(state, nonce, OIDC_SCOPE);

    logger.info('Login started', { flowId });

    return Response.redirect(authorizationUrl, 302, session.getCookie());
  }
}
