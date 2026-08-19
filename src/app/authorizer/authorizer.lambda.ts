import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { APIGatewayRequestAuthorizerEventV2 } from 'aws-lambda';
import { AuthorizerRequestHandler, AuthorizerResult } from './AuthorizerRequestHandler';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';
import { countMetric, metrics } from '../../observability/Metrics';
import { createAuditTrail } from '../../shared/audit/createAuditTrail';

const dynamoDBClient = new DynamoDBClient({});
const requestHandler = new AuthorizerRequestHandler(dynamoDBClient, createAuditTrail(dynamoDBClient));

export async function handler(event: APIGatewayRequestAuthorizerEventV2): Promise<AuthorizerResult> {
  try {
    return await requestHandler.handleRequest(event.cookies?.join(';'));
  } catch (error) {
    logger.error('Unhandled error in authorizer', { reason: errorReason(error) });
    countMetric('UnhandledError');
    return { isAuthorized: false };
  } finally {
    metrics.publishStoredMetrics();
  }
}
