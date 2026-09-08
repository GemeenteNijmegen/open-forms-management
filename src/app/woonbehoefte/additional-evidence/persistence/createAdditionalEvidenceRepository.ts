import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { AdditionalEvidenceRepository } from './AdditionalEvidenceRepository';

export function createAdditionalEvidenceRepository(dynamoDBClient: DynamoDBClient): AdditionalEvidenceRepository {
  const env = environmentVariables(['WOONBEHOEFTE_CASES_TABLE'] as const);
  return new AdditionalEvidenceRepository(DynamoDBDocumentClient.from(dynamoDBClient), env.WOONBEHOEFTE_CASES_TABLE);
}
