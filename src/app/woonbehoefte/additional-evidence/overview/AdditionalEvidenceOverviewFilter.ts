import { AdditionalEvidenceWorkItemStatus } from '../persistence/AdditionalEvidenceRepository';

const STATUSES: AdditionalEvidenceWorkItemStatus[] = ['NEW', 'UNKNOWN', 'LINKED'];

function isAdditionalEvidenceWorkItemStatus(value: string): value is AdditionalEvidenceWorkItemStatus {
  return (STATUSES as string[]).includes(value);
}

export interface AdditionalEvidenceOverviewFilter {
  statuses: AdditionalEvidenceWorkItemStatus[];
  search?: string;
}

function splitValues(value: string | undefined): string[] {
  return value ? value.split(',').filter((entry) => entry.length > 0) : [];
}

/** No filter query params at all: an unfiltered overview (every status, including LINKED), not "everything unchecked". */
export function resolveAdditionalEvidenceOverviewFilter(
  queryStringParameters: Record<string, string | undefined> | undefined,
): AdditionalEvidenceOverviewFilter {
  const qsp = queryStringParameters ?? {};
  return {
    statuses: splitValues(qsp.status).filter(isAdditionalEvidenceWorkItemStatus),
    ...(qsp.search?.trim() ? { search: qsp.search.trim() } : {}),
  };
}

export function serializeAdditionalEvidenceOverviewFilter(filter: AdditionalEvidenceOverviewFilter): string {
  const params = new URLSearchParams();
  if (filter.statuses.length > 0) {
    params.set('status', filter.statuses.join(','));
  }
  if (filter.search) {
    params.set('search', filter.search);
  }
  return params.toString();
}

/**
 * Re-sanitizes an arbitrary/possibly-tampered-with query string (e.g. a hidden form field a browser
 * posted back) by round-tripping it through the same known-parameter parsing the overview page itself
 * uses. Never trust the raw string directly: only the known filter keys/values survive.
 */
export function sanitizeAdditionalEvidenceFilterQuery(rawQuery: string | undefined): string {
  if (!rawQuery) {
    return '';
  }
  const parsed = Object.fromEntries(new URLSearchParams(rawQuery)) as Record<string, string | undefined>;
  return serializeAdditionalEvidenceOverviewFilter(resolveAdditionalEvidenceOverviewFilter(parsed));
}
