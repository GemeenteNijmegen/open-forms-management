import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { Session } from '@gemeentenijmegen/session';
import logoutTemplate from './templates/logout.mustache';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';
import { xRayTraceId } from '../../observability/xRayTraceId';
import { AuditTrail } from '../../shared/audit/AuditTrail';
import { recordAudit } from '../../shared/audit/recordAudit';
import { render } from '../../shared/rendering/Renderer';

export class LogoutRequestHandler {
  constructor(private readonly auditTrail: AuditTrail) { }

  async handleRequest(cookieHeader: string | undefined, dynamoDBClient: DynamoDBClient): Promise<ApiGatewayV2Response> {
    const session = new Session(cookieHeader ?? '', dynamoDBClient);
    const existingSession = await session.init();
    const correlationId = xRayTraceId();

    if (existingSession) {
      const email = session.getValue('email');
      const actorEmail = typeof email === 'string' && email.length > 0 ? email : undefined;

      try {
        await session.updateSession({ loggedin: { BOOL: false } });
      } catch (error) {
        const reason = errorReason(error);
        logger.error('Failed to revoke session on logout', { reason });
        await recordAudit(this.auditTrail, {
          eventType: 'SESSION_REVOKED', outcome: 'FAILURE', correlationId, ...(actorEmail ? { actorEmail } : {}), metadata: { reason },
        });
        return Response.error(500);
      }
      logger.info('Logout completed');
      await recordAudit(this.auditTrail, { eventType: 'SESSION_REVOKED', outcome: 'SUCCESS', correlationId, ...(actorEmail ? { actorEmail } : {}) });
      await recordAudit(this.auditTrail, { eventType: 'LOGOUT', outcome: 'SUCCESS', correlationId, ...(actorEmail ? { actorEmail } : {}) });
    } else {
      logger.info('Logout requested without an active session');
    }

    // Force an empty Set-Cookie: session.sessionId still holds the old
    // token, but the DynamoDB record it refers to is revoked above.
    session.sessionId = false;
    // A redirect straight to /login re-triggers the OIDC authorize request, which Entra silently approves
    // when its own SSO session is still active, undoing the logout the medewerker just asked for. Showing
    // a confirmation page with a manual /login link avoids that silent re-authentication.
    const html = render(logoutTemplate, { title: 'Uitgelogd', features: [], currentPath: '/logout' });
    return Response.html(html, 200, session.getCookie());
  }
}
