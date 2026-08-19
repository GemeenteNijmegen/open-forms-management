import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { LogoutRequestHandler } from './LogoutRequestHandler';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';
import { countMetric, metrics } from '../../observability/Metrics';
import { createAuditTrail } from '../../shared/audit/createAuditTrail';

const dynamoDBClient = new DynamoDBClient({});
const requestHandler = new LogoutRequestHandler(createAuditTrail(dynamoDBClient));

export async function handler(event: APIGatewayProxyEventV2): Promise<ApiGatewayV2Response> {
  try {
    return await requestHandler.handleRequest(event.cookies?.join(';'), dynamoDBClient);
  } catch (error) {
    logger.error('Unhandled error in logout', { reason: errorReason(error) });
    countMetric('UnhandledError');
    return Response.error(500);
  } finally {
    metrics.publishStoredMetrics();
  }
}
