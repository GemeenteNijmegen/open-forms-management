import { z } from 'zod';
import { logger } from '../../../observability/Logger';
import { HttpClientError } from '../http/HttpClientError';
import { isValidIsoDate } from '../utils/format';

/** `record.data` stays fully open: Sport-domain validation happens outside this client. */
const objectRecordSchema = z.looseObject({
  data: z.unknown(),
  registrationAt: z.string().optional(),
});

const objectResourceSchema = z.looseObject({
  uuid: z.string().optional(),
  url: z.string().optional(),
  type: z.string().optional(),
  record: objectRecordSchema,
});

const objectsPageSchema = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(objectResourceSchema),
});

export type ObjectRecord = z.infer<typeof objectRecordSchema>;
export type ObjectResource = z.infer<typeof objectResourceSchema>;
export type ObjectsPage = z.infer<typeof objectsPageSchema>;

export function parseObjectsPage(body: unknown): ObjectsPage {
  const result = objectsPageSchema.safeParse(body);
  if (!result.success) {
    logger.warn('Objects page response failed validation', { issues: summarizeZodIssues(result.error) });
    throw new HttpClientError('invalid-response', 'Objects page response failed validation', { cause: result.error });
  }
  return result.data;
}

export function parseObjectResource(body: unknown): ObjectResource {
  const result = objectResourceSchema.safeParse(body);
  if (!result.success) {
    logger.warn('Object response failed validation', { issues: summarizeZodIssues(result.error) });
    throw new HttpClientError('invalid-response', 'Object response failed validation', { cause: result.error });
  }
  return result.data;
}

/** Path + message only: zod issues describe shape mismatches, never the actual (possibly sensitive) received value. */
function summarizeZodIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

/** Only called while a registrationRange is active; never guesses a missing/invalid date. */
export function requireRegistrationAt(object: ObjectResource): string {
  const { registrationAt } = object.record;
  if (!registrationAt || !isValidIsoDate(registrationAt)) {
    logger.warn('Object record is missing a valid registrationAt while a registration range is active', { uuid: object.uuid, registrationAt });
    throw new HttpClientError(
      'invalid-response',
      'Object record is missing a valid registrationAt while a registration range is active',
    );
  }
  return registrationAt;
}
