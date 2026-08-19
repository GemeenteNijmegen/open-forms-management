import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { APIGatewayRequestAuthorizerEventV2 } from 'aws-lambda';
import { AuthorizerRequestHandler } from './AuthorizerRequestHandler';

const dynamoDBClient = new DynamoDBClient({});
const requestHandler = new AuthorizerRequestHandler(dynamoDBClient);

export async function handler(event: APIGatewayRequestAuthorizerEventV2) {
  return requestHandler.handleRequest(event.cookies?.join(';'));
}
