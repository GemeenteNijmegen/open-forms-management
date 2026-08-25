import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { WoonbehoefteSourceCacheStore } from './WoonbehoefteSourceCacheStore';

export function createWoonbehoefteSourceCacheStore(dynamoDBClient: DynamoDBClient): WoonbehoefteSourceCacheStore {
  const env = environmentVariables(['WOONBEHOEFTE_SOURCE_CACHE_TABLE'] as const);
  return new WoonbehoefteSourceCacheStore(DynamoDBDocumentClient.from(dynamoDBClient), env.WOONBEHOEFTE_SOURCE_CACHE_TABLE);
}
