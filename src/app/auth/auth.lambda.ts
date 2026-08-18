import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { AuthRequestHandler } from './AuthRequestHandler';
import { logger } from '../../observability/Logger';
import { EntraOidcClient } from '../../shared/auth/EntraOidcClient';
import { loadOidcConfiguration } from '../../shared/auth/OidcConfiguration';

const dynamoDBClient = new DynamoDBClient({});

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

export async function handler(event: APIGatewayProxyEventV2): Promise<ApiGatewayV2Response> {
  try {
    const client = await initialize();
    const requestHandler = new AuthRequestHandler({
      cookies: event.cookies?.join(';'),
      fullUrl: callbackUrl(event),
      queryStringParamError: event.queryStringParameters?.error,
      dynamoDBClient,
      oidcClient: client,
    });
    return await requestHandler.handleRequest();
  } catch (error) {
    logger.error('Unhandled error in auth callback', { reason: error instanceof Error ? error.message : String(error) });
    return Response.error(500);
  }
}
