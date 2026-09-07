import { Context } from 'aws-lambda';
import { logger } from '../../../../observability/Logger';
import { bindRequestLogging, resetRequestLogging } from '../../../../observability/RequestLogging';

export interface AdditionalEvidenceSyncWorkerEvent {
  runId: string;
  triggerCorrelationId: string;
}

/**
 * Skeleton only: proves the Lambda/IAM/invoke wiring end-to-end. Does not yet query Objects/Open Zaak or
 * touch a refresh-state store.
 */
export async function handler(event: AdditionalEvidenceSyncWorkerEvent, context: Context): Promise<void> {
  bindRequestLogging(context);
  try {
    logger.info('Additional Evidence sync worker invoked', { runId: event.runId, triggerCorrelationId: event.triggerCorrelationId });
  } finally {
    resetRequestLogging();
  }
}
