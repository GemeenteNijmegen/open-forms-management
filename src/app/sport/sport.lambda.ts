import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { SportRequestHandler } from './SportRequestHandler';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';
import { countMetric, metrics } from '../../observability/Metrics';
import { bindRequestLogging, resetRequestLogging } from '../../observability/RequestLogging';
import { createAuditTrail } from '../../shared/audit/createAuditTrail';
import { requireSession } from '../../shared/auth/requireSession';
import { AuthorizationService } from '../../shared/authorization/AuthorizationService';
import { createPermissionRepository } from '../../shared/authorization/createPermissionRepository';
import { getObjectsClient } from '../../shared/clients/objects/ObjectsClientFactory';
import { getOpenZaakClient } from '../../shared/clients/open-zaak/OpenZaakClientFactory';

const dynamoDBClient = new DynamoDBClient({});
const auditTrail = createAuditTrail(dynamoDBClient);
const authorizationService = new AuthorizationService(createPermissionRepository(dynamoDBClient), auditTrail);

export async function handler(event: APIGatewayProxyEventV2, context: Context): Promise<ApiGatewayV2Response> {
  bindRequestLogging(context);
  try {
    const identity = await requireSession(event.cookies?.join(';'), dynamoDBClient, auditTrail);
    if (!identity) {
      return Response.redirect('/login', 302);
    }

    const [objectsClient, openZaakClient] = await Promise.all([getObjectsClient(), getOpenZaakClient()]);
    const requestHandler = new SportRequestHandler(authorizationService, objectsClient, openZaakClient);
    return await requestHandler.handleRequest(identity);
  } catch (error) {
    logger.error('Unhandled error in sport', { reason: errorReason(error) });
    countMetric('UnhandledError');
    return Response.error(500);
  } finally {
    metrics.publishStoredMetrics();
    resetRequestLogging();
  }
}
