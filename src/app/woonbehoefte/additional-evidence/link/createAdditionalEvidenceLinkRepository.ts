import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { AdditionalEvidenceLinkRepository } from './AdditionalEvidenceLinkRepository';

export function createAdditionalEvidenceLinkRepository(dynamoDBClient: DynamoDBClient): AdditionalEvidenceLinkRepository {
  const env = environmentVariables(['WOONBEHOEFTE_CASES_TABLE'] as const);
  return new AdditionalEvidenceLinkRepository(DynamoDBDocumentClient.from(dynamoDBClient), env.WOONBEHOEFTE_CASES_TABLE);
}
