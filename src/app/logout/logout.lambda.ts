import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { LogoutRequestHandler } from './LogoutRequestHandler';

const dynamoDBClient = new DynamoDBClient({});
const requestHandler = new LogoutRequestHandler();

export async function handler(event: APIGatewayProxyEventV2) {
  return requestHandler.handleRequest(event.cookies?.join(';'), dynamoDBClient);
}
