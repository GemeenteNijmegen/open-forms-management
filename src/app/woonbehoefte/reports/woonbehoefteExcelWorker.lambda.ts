import { Context } from 'aws-lambda';
import { logger } from '../../../observability/Logger';
import { bindRequestLogging, resetRequestLogging } from '../../../observability/RequestLogging';

export interface WoonbehoefteExcelWorkerEvent {
  reportId: string;
}

export async function handler(event: WoonbehoefteExcelWorkerEvent, context: Context): Promise<void> {
  bindRequestLogging(context);
  try {
    logger.info('WoonbehoefteExcelWorker invoked', { reportId: event.reportId });
  } finally {
    resetRequestLogging();
  }
}
