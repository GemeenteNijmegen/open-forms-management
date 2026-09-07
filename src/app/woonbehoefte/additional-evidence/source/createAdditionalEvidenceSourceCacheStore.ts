import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { AdditionalEvidenceSourceCacheStore } from './AdditionalEvidenceSourceCacheStore';

export function createAdditionalEvidenceSourceCacheStore(dynamoDBClient: DynamoDBClient): AdditionalEvidenceSourceCacheStore {
  const env = environmentVariables(['WOONBEHOEFTE_SOURCE_CACHE_TABLE'] as const);
  return new AdditionalEvidenceSourceCacheStore(DynamoDBDocumentClient.from(dynamoDBClient), env.WOONBEHOEFTE_SOURCE_CACHE_TABLE);
}
