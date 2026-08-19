import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Session } from '@gemeentenijmegen/session';
import { logger } from '../../observability/Logger';
import { EmployeeIdentity } from '../../shared/auth/EmployeeIdentity';

export type AuthorizerContext = EmployeeIdentity;

export interface AuthorizerResult {
  isAuthorized: boolean;
  context?: AuthorizerContext;
}

/**
 * Validates the session cookie for protected routes and returns a compact
 * identity context to the route Lambda. Authentication only, it does not
 * decide feature or resource access. `email` is included when the session
 * has one, since permission grants are looked up by email, not principalId.
 */
export class AuthorizerRequestHandler {
  constructor(private readonly dynamoDBClient: DynamoDBClient) { }

  async handleRequest(cookieHeader: string | undefined): Promise<AuthorizerResult> {
    const session = new Session(cookieHeader ?? '', this.dynamoDBClient);
    await session.init();

    if (session.sessionId === false || !session.isLoggedIn()) {
      logger.info('Authorization denied: no valid session');
      return { isAuthorized: false };
    }

    const principalId = session.getValue('principalId');
    if (typeof principalId !== 'string' || principalId.length === 0) {
      logger.info('Authorization denied: session has no principalId');
      return { isAuthorized: false };
    }

    const email = session.getValue('email');

    logger.info('Authorization granted');
    return {
      isAuthorized: true,
      context: { principalId, ...(typeof email === 'string' && email.length > 0 ? { email } : {}) },
    };
  }
}
