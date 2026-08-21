import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Session } from '@gemeentenijmegen/session';
import { EmployeeIdentity } from './EmployeeIdentity';
import { logger } from '../../observability/Logger';
import { countMetric } from '../../observability/Metrics';
import { xRayTraceId } from '../../observability/xRayTraceId';
import { AuditTrail } from '../audit/AuditTrail';
import { recordAudit } from '../audit/recordAudit';

/**
 * Validates the session cookie for a protected page lambda. Returns the medewerker's identity, or
 * undefined when there is no valid session - the caller redirects to /login in that case. `email` is
 * included when the session has one, since permission grants are looked up by email, not principalId.
 */
export async function requireSession(
  cookieHeader: string | undefined,
  dynamoDBClient: DynamoDBClient,
  auditTrail: AuditTrail,
): Promise<EmployeeIdentity | undefined> {
  const session = new Session(cookieHeader ?? '', dynamoDBClient);
  await session.init();
  const correlationId = xRayTraceId();

  if (session.sessionId === false || !session.isLoggedIn()) {
    logger.info('Authentication denied: no valid session');
    countMetric('AuthenticationDenied');
    // A cookie was presented but no longer maps to a valid session, as opposed to no cookie at all: the
    // closest signal we have to "expired" without @gemeentenijmegen/session distinguishing expiry from revocation.
    if (session.sessionId !== false) {
      countMetric('SessionExpired');
    }
    await recordAudit(auditTrail, {
      eventType: 'AUTHENTICATION_DENIED', outcome: 'DENIED', correlationId, metadata: { reason: 'no-valid-session' },
    });
    return undefined;
  }

  const principalId = session.getValue('principalId');
  if (typeof principalId !== 'string' || principalId.length === 0) {
    logger.info('Authentication denied: session has no principalId');
    countMetric('AuthenticationDenied');
    await recordAudit(auditTrail, {
      eventType: 'AUTHENTICATION_DENIED', outcome: 'DENIED', correlationId, metadata: { reason: 'missing-principal-id' },
    });
    return undefined;
  }

  const email = session.getValue('email');
  logger.info('Authentication granted');
  return { principalId, ...(typeof email === 'string' && email.length > 0 ? { email } : {}) };
}
