import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { LogoutRequestHandler } from './LogoutRequestHandler';
import { createAuditTrail } from '../../shared/audit/createAuditTrail';

const dynamoDBClient = new DynamoDBClient({});
const requestHandler = new LogoutRequestHandler(createAuditTrail(dynamoDBClient));

export async function handler(event: APIGatewayProxyEventV2) {
  return requestHandler.handleRequest(event.cookies?.join(';'), dynamoDBClient);
}
