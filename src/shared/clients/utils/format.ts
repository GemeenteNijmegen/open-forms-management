const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Shared by every client that validates a UUID path segment (Objects, Open Zaak). */
export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Shared by every client that validates a `YYYY-MM-DD` query value or field. */
export function isValidIsoDate(value: string): boolean {
  return ISO_DATE_PATTERN.test(value);
}
