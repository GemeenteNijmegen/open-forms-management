import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Session } from '@gemeentenijmegen/session';
import { logger } from '../../observability/Logger';

export interface AuthorizerContext {
  principalId: string;
}

export interface AuthorizerResult {
  isAuthorized: boolean;
  context?: AuthorizerContext;
}

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

    logger.info('Authorization granted');
    return { isAuthorized: true, context: { principalId } };
  }
}
