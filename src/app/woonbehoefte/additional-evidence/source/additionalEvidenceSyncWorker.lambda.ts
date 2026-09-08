import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Context } from 'aws-lambda';
import { runAdditionalEvidenceSyncRefresh } from './AdditionalEvidenceSyncWorkerRunner';
import { createAdditionalEvidenceSourceCacheStore } from './createAdditionalEvidenceSourceCacheStore';
import { errorReason } from '../../../../observability/errorReason';
import { logger } from '../../../../observability/Logger';
import { bindRequestLogging, resetRequestLogging } from '../../../../observability/RequestLogging';
import { getObjectsClient } from '../../../../shared/clients/objects/ObjectsClientFactory';
import { getOpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClientFactory';
import { createAdditionalEvidenceRepository } from '../persistence/createAdditionalEvidenceRepository';

export interface AdditionalEvidenceSyncWorkerEvent {
  runId: string;
  triggerCorrelationId: string;
}

// Stops starting new work with a comfortable margin before the Lambda's own 900s (15 min) hard timeout.
const CUTOFF_SAFETY_MARGIN_MS = 2 * 60 * 1000;

const dynamoDBClient = new DynamoDBClient({});
const sourceCacheStore = createAdditionalEvidenceSourceCacheStore(dynamoDBClient);
const repository = createAdditionalEvidenceRepository(dynamoDBClient);

export async function handler(event: AdditionalEvidenceSyncWorkerEvent, context: Context): Promise<void> {
  bindRequestLogging(context);
  try {
    const [objectsClient, openZaakClient] = await Promise.all([getObjectsClient(), getOpenZaakClient()]);

    await runAdditionalEvidenceSyncRefresh(
      event.runId,
      { objectsClient, openZaakClient, sourceCacheStore, repository },
      () => context.getRemainingTimeInMillis() <= CUTOFF_SAFETY_MARGIN_MS,
      event.triggerCorrelationId,
    );
  } catch (error) {
    logger.error('AdditionalEvidenceSyncWorker failed unexpectedly', { runId: event.runId, reason: errorReason(error) });
    await sourceCacheStore.finalizeRefresh(event.runId, 'FAILED', new Date(), { failureReason: 'UNEXPECTED_ERROR' });
  } finally {
    resetRequestLogging();
  }
}
