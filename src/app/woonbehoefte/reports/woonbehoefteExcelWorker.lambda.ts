import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { environmentVariables } from '@gemeentenijmegen/utils';
import { Context } from 'aws-lambda';
import { createWoonbehoefteReportStore } from './store/createWoonbehoefteReportStore';
import { runWoonbehoefteExcelReport } from './WoonbehoefteExcelWorkerRunner';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { bindRequestLogging, resetRequestLogging } from '../../../observability/RequestLogging';
import { xRayTraceId } from '../../../observability/xRayTraceId';
import { createAuditTrail } from '../../../shared/audit/createAuditTrail';
import { getOpenZaakClient } from '../../../shared/clients/open-zaak/OpenZaakClientFactory';
import { createWoonbehoefteCaseRepository } from '../cases/createWoonbehoefteCaseRepository';
import { createWoonbehoefteSourceCacheStore } from '../source/createWoonbehoefteSourceCacheStore';

export interface WoonbehoefteExcelWorkerEvent {
  reportId: string;
}

// Stops starting new work with a comfortable margin before the Lambda's own 900s (15 min) hard timeout.
const CUTOFF_SAFETY_MARGIN_MS = 2 * 60 * 1000;

const dynamoDBClient = new DynamoDBClient({});
const s3Client = new S3Client({});
const caseRepository = createWoonbehoefteCaseRepository(dynamoDBClient);
const sourceCacheStore = createWoonbehoefteSourceCacheStore(dynamoDBClient);
const reportStore = createWoonbehoefteReportStore(dynamoDBClient);
const auditTrail = createAuditTrail(dynamoDBClient);

export async function handler(event: WoonbehoefteExcelWorkerEvent, context: Context): Promise<void> {
  bindRequestLogging(context);
  try {
    const env = environmentVariables(['WOONBEHOEFTE_REPORTS_BUCKET'] as const);
    const openZaakClient = await getOpenZaakClient();

    await runWoonbehoefteExcelReport(
      event.reportId,
      { caseRepository, sourceCacheStore, openZaakClient, s3Client, reportStore, auditTrail, bucketName: env.WOONBEHOEFTE_REPORTS_BUCKET },
      () => context.getRemainingTimeInMillis() <= CUTOFF_SAFETY_MARGIN_MS,
      xRayTraceId(),
    );
  } catch (error) {
    logger.error('WoonbehoefteExcelWorker failed unexpectedly', { reportId: event.reportId, reason: errorReason(error) });
  } finally {
    resetRequestLogging();
  }
}
