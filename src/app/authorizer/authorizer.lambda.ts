import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { APIGatewayRequestAuthorizerEventV2 } from 'aws-lambda';
import { AuthorizerRequestHandler } from './AuthorizerRequestHandler';
import { createAuditTrail } from '../../shared/audit/createAuditTrail';

const dynamoDBClient = new DynamoDBClient({});
const requestHandler = new AuthorizerRequestHandler(dynamoDBClient, createAuditTrail(dynamoDBClient));

export async function handler(event: APIGatewayRequestAuthorizerEventV2) {
  return requestHandler.handleRequest(event.cookies?.join(';'));
}
