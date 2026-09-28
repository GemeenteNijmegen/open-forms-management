import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { RankingStore } from './RankingStore';

// Same table/env var as createWoonbehoefteCaseRepository: the ranking item lives in the Cases table.
export function createRankingStore(dynamoDBClient: DynamoDBClient): RankingStore {
  const env = environmentVariables(['WOONBEHOEFTE_CASES_TABLE'] as const);
  return new RankingStore(DynamoDBDocumentClient.from(dynamoDBClient), env.WOONBEHOEFTE_CASES_TABLE);
}
