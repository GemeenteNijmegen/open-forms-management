import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { Context, DynamoDBStreamEvent } from 'aws-lambda';
import { WoonbehoefteCaseVersionStore } from './WoonbehoefteCaseVersionStore';
import { processWoonbehoefteCaseVersionRecord } from './WoonbehoefteCaseVersionWorkerRunner';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { bindRequestLogging, resetRequestLogging } from '../../../observability/RequestLogging';

const env = environmentVariables(['WOONBEHOEFTE_CASE_VERSIONS_TABLE'] as const);

const dynamoDBClient = new DynamoDBClient({});
const store = new WoonbehoefteCaseVersionStore(dynamoDBClient, env.WOONBEHOEFTE_CASE_VERSIONS_TABLE);

export async function handler(event: DynamoDBStreamEvent, context: Context): Promise<void> {
  bindRequestLogging(context);
  try {
    for (const record of event.Records) {
      await processWoonbehoefteCaseVersionRecord(record, store);
    }
  } catch (error) {
    // Rethrown so the Errors metric rises and the event source mapping retries the batch; DynamoDB Stream
    // records are only kept for a limited time, so this may never quietly swallow a failure.
    logger.error('Woonbehoefte case version worker failed', { reason: errorReason(error) });
    throw error;
  } finally {
    resetRequestLogging();
  }
}
