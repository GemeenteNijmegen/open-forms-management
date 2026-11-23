import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { EsfSearchService } from './data/EsfSearchService';
import { getEsfObjectsClient } from './data/getEsfObjectsClient';
import { EsfPageHandler } from './ui/EsfPageHandler';
import { EsfSearchHandler } from './ui/EsfSearchHandler';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';
import { countMetric, metrics } from '../../observability/Metrics';
import { bindRequestLogging, resetRequestLogging } from '../../observability/RequestLogging';
import { createAuditTrail } from '../../shared/audit/createAuditTrail';
import { requireSession } from '../../shared/auth/requireSession';
import { AuthorizationService } from '../../shared/authorization/AuthorizationService';
import { createPermissionRepository } from '../../shared/authorization/createPermissionRepository';

const dynamoDBClient = new DynamoDBClient({});
const auditTrail = createAuditTrail(dynamoDBClient);
const authorizationService = new AuthorizationService(createPermissionRepository(dynamoDBClient), auditTrail);
const pageHandler = new EsfPageHandler(authorizationService);
const searchHandler = new EsfSearchHandler(authorizationService, auditTrail, async () => {
  const env = environmentVariables(['ESF_OBJECTTYPE_URL'] as const);
  return new EsfSearchService(await getEsfObjectsClient(), env.ESF_OBJECTTYPE_URL);
});

export async function handler(event: APIGatewayProxyEventV2, context: Context): Promise<ApiGatewayV2Response> {
  bindRequestLogging(context);
  try {
    const cookieHeader = event.cookies?.join(';');
    const identity = await requireSession(cookieHeader, dynamoDBClient, auditTrail);
    if (!identity) {
      return Response.redirect('/login', 302);
    }
    if (event.requestContext.http.method === 'POST') {
      return await searchHandler.handleRequest(identity, cookieHeader, event.body, Boolean(event.isBase64Encoded));
    }
    return await pageHandler.handleRequest(identity);
  } catch (error) {
    logger.error('Unhandled error in esf', { reason: errorReason(error) });
    countMetric('UnhandledError');
    return Response.error(500);
  } finally {
    metrics.publishStoredMetrics();
    resetRequestLogging();
  }
}
