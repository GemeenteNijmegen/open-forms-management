import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { SportReportStore } from './SportReportStore';

export function createSportReportStore(dynamoDBClient: DynamoDBClient): SportReportStore {
  const env = environmentVariables(['SPORT_REPORTS_TABLE'] as const);
  return new SportReportStore(DynamoDBDocumentClient.from(dynamoDBClient), env.SPORT_REPORTS_TABLE);
}
