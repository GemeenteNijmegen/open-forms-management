import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { APIGatewayProxyEventV2WithLambdaAuthorizer, Context } from 'aws-lambda';
import { HomeRequestHandler } from './HomeRequestHandler';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';
import { countMetric, metrics } from '../../observability/Metrics';
import { bindRequestLogging, resetRequestLogging } from '../../observability/RequestLogging';
import { createAuditTrail } from '../../shared/audit/createAuditTrail';
import { AuthorizationService } from '../../shared/authorization/AuthorizationService';
import { createPermissionRepository } from '../../shared/authorization/createPermissionRepository';
import { AuthorizerContext } from '../authorizer/AuthorizerRequestHandler';

const dynamoDBClient = new DynamoDBClient({});
const authorizationService = new AuthorizationService(createPermissionRepository(dynamoDBClient), createAuditTrail(dynamoDBClient));
const requestHandler = new HomeRequestHandler(authorizationService);

export async function handler(
  event: APIGatewayProxyEventV2WithLambdaAuthorizer<AuthorizerContext>,
  context: Context,
): Promise<ApiGatewayV2Response> {
  bindRequestLogging(context);
  try {
    return await requestHandler.handleRequest(event.requestContext.authorizer.lambda, event.rawPath);
  } catch (error) {
    logger.error('Unhandled error in home', { reason: errorReason(error) });
    countMetric('UnhandledError');
    return Response.error(500);
  } finally {
    metrics.publishStoredMetrics();
    resetRequestLogging();
  }
}
