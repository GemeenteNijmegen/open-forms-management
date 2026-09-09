import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { WoonbehoefteReportStore } from './WoonbehoefteReportStore';

export function createWoonbehoefteReportStore(dynamoDBClient: DynamoDBClient): WoonbehoefteReportStore {
  const env = environmentVariables(['WOONBEHOEFTE_REPORTS_TABLE'] as const);
  return new WoonbehoefteReportStore(DynamoDBDocumentClient.from(dynamoDBClient), env.WOONBEHOEFTE_REPORTS_TABLE);
}
