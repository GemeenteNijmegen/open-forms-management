import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { Context } from 'aws-lambda';
import { runSportExcelReport } from './SportExcelWorkerRunner';
import { createSportReportStore } from './store/createSportReportStore';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { bindRequestLogging, resetRequestLogging } from '../../../observability/RequestLogging';
import { xRayTraceId } from '../../../observability/xRayTraceId';
import { createAuditTrail } from '../../../shared/audit/createAuditTrail';
import { getObjectsClient } from '../../../shared/clients/objects/ObjectsClientFactory';
import { getOpenZaakClient } from '../../../shared/clients/open-zaak/OpenZaakClientFactory';

export interface SportExcelWorkerEvent {
  reportId: string;
}

// Stops starting new work with a comfortable margin before the Lambda's own 900s (15 min) hard timeout.
const CUTOFF_SAFETY_MARGIN_MS = 2 * 60 * 1000;

const dynamoDBClient = new DynamoDBClient({});
const s3Client = new S3Client({});
const reportStore = createSportReportStore(dynamoDBClient);
const auditTrail = createAuditTrail(dynamoDBClient);

export async function handler(event: SportExcelWorkerEvent, context: Context): Promise<void> {
  bindRequestLogging(context);
  try {
    const env = environmentVariables(['SPORT_REPORTS_BUCKET'] as const);
    const [objectsClient, openZaakClient] = await Promise.all([getObjectsClient(), getOpenZaakClient()]);

    await runSportExcelReport(
      event.reportId,
      { objectsClient, openZaakClient, s3Client, reportStore, auditTrail, bucketName: env.SPORT_REPORTS_BUCKET },
      () => context.getRemainingTimeInMillis() <= CUTOFF_SAFETY_MARGIN_MS,
      xRayTraceId(),
    );
  } catch (error) {
    logger.error('SportExcelWorker failed unexpectedly', { reportId: event.reportId, reason: errorReason(error) });
  } finally {
    resetRequestLogging();
  }
}
