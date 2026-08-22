import { randomUUID } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { Session } from '@gemeentenijmegen/session';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';
import { countMetric } from '../../observability/Metrics';
import { xRayTraceId } from '../../observability/xRayTraceId';
import { AuditTrail } from '../../shared/audit/AuditTrail';
import { recordAudit } from '../../shared/audit/recordAudit';
import { OidcClient } from '../../shared/auth/OidcClient';

const OIDC_SCOPE = 'openid email';

export class LoginRequestHandler {
  constructor(private readonly oidcClient: OidcClient, private readonly auditTrail: AuditTrail) { }

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

    let authorizationUrl: string;
    try {
      logger.debug('Building OIDC authorization request', { flowId });
      authorizationUrl = await this.oidcClient.getAuthorizationUrl(state, nonce, OIDC_SCOPE);

      await session.createSession({
        loggedin: { BOOL: false },
        state: { S: state },
        nonce: { S: nonce },
        flowId: { S: flowId },
      });
    } catch (error) {
      const reason = errorReason(error);
      logger.error('Failed to start login', { flowId, reason });
      countMetric('LoginFailure');
      await recordAudit(this.auditTrail, {
        eventType: 'LOGIN_FAILED', outcome: 'FAILURE', correlationId: xRayTraceId(), flowId, metadata: { reason },
      });
      return Response.error(500);
    }

    logger.info('Login started', { flowId });
    await recordAudit(this.auditTrail, { eventType: 'LOGIN_STARTED', outcome: 'SUCCESS', correlationId: xRayTraceId(), flowId });

    return Response.redirect(authorizationUrl, 302, session.getCookie());
  }
}
