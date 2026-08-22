import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { LoginPageRequestHandler } from './LoginPageRequestHandler';
import { LoginRequestHandler } from './LoginRequestHandler';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';
import { countMetric, metrics } from '../../observability/Metrics';
import { bindRequestLogging, resetRequestLogging } from '../../observability/RequestLogging';
import { createAuditTrail } from '../../shared/audit/createAuditTrail';
import { EntraOidcClient } from '../../shared/auth/EntraOidcClient';
import { loadOidcConfiguration } from '../../shared/auth/OidcConfiguration';

const dynamoDBClient = new DynamoDBClient({});
const auditTrail = createAuditTrail(dynamoDBClient);
const pageRequestHandler = new LoginPageRequestHandler();

let startRequestHandler: LoginRequestHandler | undefined;
async function initializeStartRequestHandler(): Promise<LoginRequestHandler> {
  if (!startRequestHandler) {
    const configuration = await loadOidcConfiguration();
    startRequestHandler = new LoginRequestHandler(new EntraOidcClient(configuration), auditTrail);
  }
  return startRequestHandler;
}

export async function handler(event: APIGatewayProxyEventV2, context: Context): Promise<ApiGatewayV2Response> {
  bindRequestLogging(context);
  try {
    if (event.rawPath.endsWith('/start')) {
      const requestHandler = await initializeStartRequestHandler();
      return await requestHandler.handleRequest(event.cookies?.join(';'), dynamoDBClient);
    }
    return await pageRequestHandler.handleRequest(event.cookies?.join(';'), dynamoDBClient, event.queryStringParameters?.failed === '1');
  } catch (error) {
    logger.error('Unhandled error in login', { reason: errorReason(error) });
    countMetric('UnhandledError');
    return Response.error(500);
  } finally {
    metrics.publishStoredMetrics();
    resetRequestLogging();
  }
}
