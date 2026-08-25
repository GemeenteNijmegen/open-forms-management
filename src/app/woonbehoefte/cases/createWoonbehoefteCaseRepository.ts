import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { WoonbehoefteCaseRepository } from './WoonbehoefteCaseRepository';

export function createWoonbehoefteCaseRepository(dynamoDBClient: DynamoDBClient): WoonbehoefteCaseRepository {
  const env = environmentVariables(['WOONBEHOEFTE_CASES_TABLE'] as const);
  return new WoonbehoefteCaseRepository(DynamoDBDocumentClient.from(dynamoDBClient), env.WOONBEHOEFTE_CASES_TABLE);
}
