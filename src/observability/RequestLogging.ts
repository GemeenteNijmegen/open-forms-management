import type { Context } from 'aws-lambda';
import { logger } from './Logger';
import { xRayTraceId } from './xRayTraceId';

/** Returns the correlation ID it just bound, so a handler can also hand it to the browser as `X-Correlation-Id`. */
export function bindRequestLogging(context: Context): string {
  const correlationId = xRayTraceId();
  logger.addContext(context);
  logger.appendKeys({ correlationId });
  return correlationId;
}

// appendKeys blijft hangen op een warme container tot je 'm zelf opruimt, dus dit hoort in de finally.
export function resetRequestLogging(): void {
  logger.resetKeys();
}
