import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { LoginRequestHandler } from './LoginRequestHandler';
import { EntraOidcClient } from '../../shared/auth/EntraOidcClient';
import { loadOidcConfiguration } from '../../shared/auth/OidcConfiguration';

const dynamoDBClient = new DynamoDBClient({});

let requestHandler: LoginRequestHandler | undefined;
async function initialize(): Promise<LoginRequestHandler> {
  if (!requestHandler) {
    const configuration = await loadOidcConfiguration();
    requestHandler = new LoginRequestHandler(new EntraOidcClient(configuration));
  }
  return requestHandler;
}

export async function handler(event: APIGatewayProxyEventV2) {
  const handlerInstance = await initialize();
  return handlerInstance.handleRequest(event.cookies?.join(';'), dynamoDBClient);
}
