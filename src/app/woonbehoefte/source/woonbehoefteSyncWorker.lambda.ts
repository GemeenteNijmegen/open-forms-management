import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Context } from 'aws-lambda';
import { createWoonbehoefteSourceCacheStore } from './createWoonbehoefteSourceCacheStore';
import { runWoonbehoefteSyncRefresh } from './WoonbehoefteSyncWorkerRunner';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { bindRequestLogging, resetRequestLogging } from '../../../observability/RequestLogging';
import { getObjectsClient } from '../../../shared/clients/objects/ObjectsClientFactory';
import { getOpenZaakClient } from '../../../shared/clients/open-zaak/OpenZaakClientFactory';
import { createWoonbehoefteCaseRepository } from '../cases/createWoonbehoefteCaseRepository';

export interface WoonbehoefteSyncWorkerEvent {
  runId: string;
  triggerCorrelationId: string;
}

// Stops starting new work with a comfortable margin before the Lambda's own 900s (15 min) hard timeout.
const CUTOFF_SAFETY_MARGIN_MS = 2 * 60 * 1000;

const dynamoDBClient = new DynamoDBClient({});
const sourceCacheStore = createWoonbehoefteSourceCacheStore(dynamoDBClient);
const caseRepository = createWoonbehoefteCaseRepository(dynamoDBClient);

export async function handler(event: WoonbehoefteSyncWorkerEvent, context: Context): Promise<void> {
  bindRequestLogging(context);
  try {
    const [objectsClient, openZaakClient] = await Promise.all([getObjectsClient(), getOpenZaakClient()]);

    await runWoonbehoefteSyncRefresh(
      event.runId,
      { objectsClient, openZaakClient, sourceCacheStore, caseRepository },
      () => context.getRemainingTimeInMillis() <= CUTOFF_SAFETY_MARGIN_MS,
      event.triggerCorrelationId,
    );
  } catch (error) {
    logger.error('WoonbehoefteSyncWorker failed unexpectedly', { runId: event.runId, reason: errorReason(error) });
    await sourceCacheStore.finalizeRefresh(event.runId, 'FAILED', new Date(), { failureReason: 'UNEXPECTED_ERROR' });
  } finally {
    resetRequestLogging();
  }
}
