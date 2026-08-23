import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Context } from 'aws-lambda';
import { createSportCacheStore } from './createSportCacheStore';
import { runSportCacheRefresh } from './SportCacheWorkerRunner';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { bindRequestLogging, resetRequestLogging } from '../../../observability/RequestLogging';
import { getObjectsClient } from '../../../shared/clients/objects/ObjectsClientFactory';
import { getOpenZaakClient } from '../../../shared/clients/open-zaak/OpenZaakClientFactory';

export interface SportCacheWorkerEvent {
  runId: string;
  triggerCorrelationId: string;
}

// Stops starting new work with a comfortable margin before the Lambda's own 900s (15 min) hard timeout.
const CUTOFF_SAFETY_MARGIN_MS = 2 * 60 * 1000;

const dynamoDBClient = new DynamoDBClient({});
const cacheStore = createSportCacheStore(dynamoDBClient);

export async function handler(event: SportCacheWorkerEvent, context: Context): Promise<void> {
  bindRequestLogging(context);
  try {
    const [objectsClient, openZaakClient] = await Promise.all([getObjectsClient(), getOpenZaakClient()]);

    await runSportCacheRefresh(
      event.runId,
      { objectsClient, openZaakClient, cacheStore },
      () => context.getRemainingTimeInMillis() <= CUTOFF_SAFETY_MARGIN_MS,
      event.triggerCorrelationId,
    );
  } catch (error) {
    logger.error('SportCacheWorker failed unexpectedly', { runId: event.runId, reason: errorReason(error) });
  } finally {
    resetRequestLogging();
  }
}
