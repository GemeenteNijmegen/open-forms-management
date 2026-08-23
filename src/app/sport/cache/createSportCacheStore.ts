import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { SportCacheStore } from './SportCacheStore';

export function createSportCacheStore(dynamoDBClient: DynamoDBClient): SportCacheStore {
  const env = environmentVariables(['SPORT_CACHE_TABLE'] as const);
  return new SportCacheStore(DynamoDBDocumentClient.from(dynamoDBClient), env.SPORT_CACHE_TABLE);
}
