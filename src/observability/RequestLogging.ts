import type { Context } from 'aws-lambda';
import { logger } from './Logger';
import { xRayTraceId } from './xRayTraceId';

export function bindRequestLogging(context: Context): void {
  logger.addContext(context);
  logger.appendKeys({ correlationId: xRayTraceId() });
}

// appendKeys blijft hangen op een warme container tot je 'm zelf opruimt, dus dit hoort in de finally.
export function resetRequestLogging(): void {
  logger.resetKeys();
}
