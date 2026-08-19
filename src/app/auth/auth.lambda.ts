import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { AuthRequestHandler } from './AuthRequestHandler';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';
import { countMetric, metrics } from '../../observability/Metrics';
import { bindRequestLogging, resetRequestLogging } from '../../observability/RequestLogging';
import { createAuditTrail } from '../../shared/audit/createAuditTrail';
import { EntraOidcClient } from '../../shared/auth/EntraOidcClient';
import { loadOidcConfiguration } from '../../shared/auth/OidcConfiguration';

const dynamoDBClient = new DynamoDBClient({});
const auditTrail = createAuditTrail(dynamoDBClient);

let oidcClient: EntraOidcClient | undefined;
async function initialize(): Promise<EntraOidcClient> {
  if (!oidcClient) {
    const configuration = await loadOidcConfiguration();
    oidcClient = new EntraOidcClient(configuration);
  }
  return oidcClient;
}

function callbackUrl(event: APIGatewayProxyEventV2): URL {
  return new URL(`https://${process.env.MANAGEMENT_DOMAIN}${event.rawPath}?${event.rawQueryString}`);
}

export async function handler(event: APIGatewayProxyEventV2, context: Context): Promise<ApiGatewayV2Response> {
  bindRequestLogging(context);
  try {
    const client = await initialize();
    const requestHandler = new AuthRequestHandler({
      cookies: event.cookies?.join(';'),
      fullUrl: callbackUrl(event),
      queryStringParamError: event.queryStringParameters?.error,
      dynamoDBClient,
      oidcClient: client,
      auditTrail,
    });
    return await requestHandler.handleRequest();
  } catch (error) {
    logger.error('Unhandled error in auth callback', { reason: errorReason(error) });
    countMetric('UnhandledError');
    return Response.error(500);
  } finally {
    metrics.publishStoredMetrics();
    resetRequestLogging();
  }
}
