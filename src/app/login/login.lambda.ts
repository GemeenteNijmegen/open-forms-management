import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { LoginRequestHandler } from './LoginRequestHandler';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';
import { countMetric, metrics } from '../../observability/Metrics';
import { createAuditTrail } from '../../shared/audit/createAuditTrail';
import { EntraOidcClient } from '../../shared/auth/EntraOidcClient';
import { loadOidcConfiguration } from '../../shared/auth/OidcConfiguration';

const dynamoDBClient = new DynamoDBClient({});
const auditTrail = createAuditTrail(dynamoDBClient);

let requestHandler: LoginRequestHandler | undefined;
async function initialize(): Promise<LoginRequestHandler> {
  if (!requestHandler) {
    const configuration = await loadOidcConfiguration();
    requestHandler = new LoginRequestHandler(new EntraOidcClient(configuration), auditTrail);
  }
  return requestHandler;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<ApiGatewayV2Response> {
  try {
    const handlerInstance = await initialize();
    return await handlerInstance.handleRequest(event.cookies?.join(';'), dynamoDBClient);
  } catch (error) {
    logger.error('Unhandled error in login', { reason: errorReason(error) });
    countMetric('UnhandledError');
    return Response.error(500);
  } finally {
    metrics.publishStoredMetrics();
  }
}
