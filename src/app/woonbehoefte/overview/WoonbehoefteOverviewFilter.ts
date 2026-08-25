import { CaseStatus, isCaseStatus } from '../domain/CaseStatus';
import { ApplicantType, isApplicantType } from '../domain/WoonbehoefteSource';

export type WoonbehoefteAssignmentFilter = 'ALL' | 'MINE' | 'UNCLAIMED';

export interface WoonbehoefteOverviewFilter {
  statuses: CaseStatus[];
  startYears: number[];
  startYearNotSet: boolean;
  applicantTypes: ApplicantType[];
  assignment: WoonbehoefteAssignmentFilter;
  checkRequestedOnly: boolean;
  search?: string;
  visibleCount: number;
}

export const START_YEAR_NOT_SET_VALUE = 'nog-niet-vastgesteld';

/** One "Meer tonen" page. Also the visibleCount floor/step: a tampered value always rounds down to a whole number of pages. */
export const OVERVIEW_PAGE_SIZE = 30;
const MAX_VISIBLE_COUNT = 1000;

function splitValues(value: string | undefined): string[] {
  return value ? value.split(',').filter((entry) => entry.length > 0) : [];
}

/** Anything not a whole number of pages between one page and MAX_VISIBLE_COUNT (missing, negative, a string, an extreme value) falls back to one page. */
function resolveVisibleCount(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < OVERVIEW_PAGE_SIZE || value > MAX_VISIBLE_COUNT) {
    return OVERVIEW_PAGE_SIZE;
  }
  return Math.floor(value / OVERVIEW_PAGE_SIZE) * OVERVIEW_PAGE_SIZE;
}

/** No filter query params at all: an unfiltered overview, not "everything unchecked". */
export function resolveWoonbehoefteOverviewFilter(queryStringParameters: Record<string, string | undefined> | undefined): WoonbehoefteOverviewFilter {
  const qsp = queryStringParameters ?? {};
  const startYearValues = splitValues(qsp.startYear);

  return {
    statuses: splitValues(qsp.status).filter(isCaseStatus),
    startYears: startYearValues.filter((value) => value !== START_YEAR_NOT_SET_VALUE).map(Number).filter(Number.isInteger),
    startYearNotSet: startYearValues.includes(START_YEAR_NOT_SET_VALUE),
    applicantTypes: splitValues(qsp.applicantType).filter(isApplicantType),
    assignment: qsp.assignment === 'mine' ? 'MINE' : qsp.assignment === 'unclaimed' ? 'UNCLAIMED' : 'ALL',
    checkRequestedOnly: qsp.check === 'requested',
    ...(qsp.search?.trim() ? { search: qsp.search.trim() } : {}),
    visibleCount: resolveVisibleCount(qsp.visible),
  };
}

/**
 * The inverse of `resolveWoonbehoefteOverviewFilter`: a canonical query string containing only known
 * filter keys/values. Used to carry the active overview filters into a detail link and back again
 * without ever trusting a raw/open string - see `sanitizeWoonbehoefteFilterQuery`.
 */
export function serializeWoonbehoefteOverviewFilter(filter: WoonbehoefteOverviewFilter): string {
  const params = new URLSearchParams();
  if (filter.statuses.length > 0) {
    params.set('status', filter.statuses.join(','));
  }
  const startYearValues = [...filter.startYears.map(String), ...(filter.startYearNotSet ? [START_YEAR_NOT_SET_VALUE] : [])];
  if (startYearValues.length > 0) {
    params.set('startYear', startYearValues.join(','));
  }
  if (filter.applicantTypes.length > 0) {
    params.set('applicantType', filter.applicantTypes.join(','));
  }
  if (filter.assignment === 'MINE') {
    params.set('assignment', 'mine');
  } else if (filter.assignment === 'UNCLAIMED') {
    params.set('assignment', 'unclaimed');
  }
  if (filter.checkRequestedOnly) {
    params.set('check', 'requested');
  }
  if (filter.search) {
    params.set('search', filter.search);
  }
  if (filter.visibleCount > OVERVIEW_PAGE_SIZE) {
    params.set('visible', String(filter.visibleCount));
  }
  return params.toString();
}

/**
 * Re-sanitizes an arbitrary/possibly-tampered-with query string (e.g. a hidden form field a browser
 * posted back) by round-tripping it through the same known-parameter parsing the overview page itself
 * uses. Never trust the raw string directly: only the known filter keys/values survive.
 */
export function sanitizeWoonbehoefteFilterQuery(rawQuery: string | undefined): string {
  if (!rawQuery) {
    return '';
  }
  const parsed = Object.fromEntries(new URLSearchParams(rawQuery)) as Record<string, string | undefined>;
  return serializeWoonbehoefteOverviewFilter(resolveWoonbehoefteOverviewFilter(parsed));
}
