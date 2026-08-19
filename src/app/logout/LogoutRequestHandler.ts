import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { Session } from '@gemeentenijmegen/session';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';

export class LogoutRequestHandler {
  async handleRequest(cookieHeader: string | undefined, dynamoDBClient: DynamoDBClient): Promise<ApiGatewayV2Response> {
    const session = new Session(cookieHeader ?? '', dynamoDBClient);
    const existingSession = await session.init();

    if (existingSession) {
      try {
        await session.updateSession({ loggedin: { BOOL: false } });
      } catch (error) {
        logger.error('Failed to revoke session on logout', { reason: errorReason(error) });
        return Response.error(500);
      }
      logger.info('Logout completed');
    } else {
      logger.info('Logout requested without an active session');
    }

    // Force an empty Set-Cookie: session.sessionId still holds the old
    // token, but the DynamoDB record it refers to is revoked above.
    session.sessionId = false;
    return Response.redirect('/login', 302, session.getCookie());
  }
}
