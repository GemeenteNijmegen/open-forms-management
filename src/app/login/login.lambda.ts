import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { LoginRequestHandler } from './LoginRequestHandler';
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

export async function handler(event: APIGatewayProxyEventV2) {
  const handlerInstance = await initialize();
  return handlerInstance.handleRequest(event.cookies?.join(';'), dynamoDBClient);
}
