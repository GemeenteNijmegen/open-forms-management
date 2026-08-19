import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { Session } from '@gemeentenijmegen/session';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';
import { xRayTraceId } from '../../observability/xRayTraceId';
import { AuditTrail } from '../../shared/audit/AuditTrail';
import { recordAudit } from '../../shared/audit/recordAudit';
import { mapToEmployeeIdentity } from '../../shared/auth/EmployeeIdentity';
import { OidcClient } from '../../shared/auth/OidcClient';

export interface AuthRequestHandlerProps {
  cookies: string | undefined;
  fullUrl: URL;
  queryStringParamError?: string;
  dynamoDBClient: DynamoDBClient;
  oidcClient: OidcClient;
  auditTrail: AuditTrail;
}

export class AuthRequestHandler {
  constructor(private readonly props: AuthRequestHandlerProps) { }

  async handleRequest(): Promise<ApiGatewayV2Response> {
    if (this.props.queryStringParamError) {
      logger.info('Authentication cancelled or failed at idp', { reason: this.props.queryStringParamError });
      return Response.redirect('/login');
    }

    const session = new Session(this.props.cookies ?? '', this.props.dynamoDBClient);
    await session.init();
    if (session.sessionId === false) {
      logger.info('OIDC callback received without a pending login session');
      return Response.redirect('/login');
    }

    const expectedState = session.getValue('state');
    const expectedNonce = session.getValue('nonce');
    const flowId = session.getValue('flowId');
    if (!expectedState || !expectedNonce) {
      logger.info('OIDC callback received without a matching pending state');
      return Response.redirect('/login');
    }

    logger.debug('OIDC callback received', { flowId });

    const correlationId = xRayTraceId();

    let identity;
    try {
      const result = await this.props.oidcClient.exchangeAuthorizationCode(this.props.fullUrl, expectedState, expectedNonce);
      identity = mapToEmployeeIdentity(result.claims);
    } catch (error) {
      const reason = errorReason(error);
      logger.info('Login failed', { flowId, reason });
      await recordAudit(this.props.auditTrail, {
        eventType: 'LOGIN_FAILED', outcome: 'FAILURE', correlationId, flowId, metadata: { reason },
      });
      return Response.redirect('/login');
    }

    await recordAudit(this.props.auditTrail, {
      eventType: 'LOGIN_SUCCEEDED', outcome: 'SUCCESS', correlationId, flowId, ...(identity.email ? { actorEmail: identity.email } : {}),
    });

    try {
      // A fresh session (new token) is created here rather than updating the
      // pending one, so the pre-login token cannot be reused after login.
      await session.createSession({
        loggedin: { BOOL: true },
        principalId: { S: identity.principalId },
        ...(identity.email ? { email: { S: identity.email } } : {}),
      });
    } catch (error) {
      const reason = errorReason(error);
      logger.error('Failed to create session after successful login', { flowId, reason });
      await recordAudit(this.props.auditTrail, {
        eventType: 'LOGIN_FAILED',
        outcome: 'FAILURE',
        correlationId,
        flowId,
        ...(identity.email ? { actorEmail: identity.email } : {}),
        metadata: { reason },
      });
      return Response.error(500);
    }

    await recordAudit(this.props.auditTrail, {
      eventType: 'SESSION_CREATED', outcome: 'SUCCESS', correlationId, flowId, ...(identity.email ? { actorEmail: identity.email } : {}),
    });

    logger.info('Login completed', { flowId });

    return Response.redirect('/home', 302, session.getCookie());
  }
}
