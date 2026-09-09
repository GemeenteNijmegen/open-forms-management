import { CaseStatus, isCaseStatus } from '../../domain/CaseStatus';
import { ApplicantType, isApplicantType } from '../../domain/WoonbehoefteSource';
import { START_YEAR_NOT_SET_VALUE, WoonbehoefteOverviewFilter } from '../../overview/WoonbehoefteOverviewFilter';
import { matchesOverviewFilter, WoonbehoefteCaseWithSource } from '../../overview/WoonbehoefteOverviewViewModel';

export type WoonbehoefteReportAssignmentFilter = 'ALL' | 'UNCLAIMED';

export interface WoonbehoefteReportFilter {
  statuses: CaseStatus[];
  startYears: number[];
  startYearNotSet: boolean;
  applicantTypes: ApplicantType[];
  assignment: WoonbehoefteReportAssignmentFilter;
  checkRequestedOnly: boolean;
  search?: string;
}

// Accepts either repeated same-name checkbox fields or one comma-separated text field (startYear uses a
// free-text field, not per-year checkboxes, see WoonbehoefteReportsOverviewHandler), by splitting every
// raw value on comma too.
function splitValues(values: string[]): string[] {
  return values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter((value) => value.length > 0);
}

/**
 * Reads a report request POST. Unknown status/applicantType values are dropped, not rejected, same
 * forgiving behaviour as the overview filter. assignment only ever resolves to ALL or UNCLAIMED: MINE is
 * not a member of this type, so it can never reach the matcher below regardless of what a form field claims.
 */
export function resolveWoonbehoefteReportFilter(form: URLSearchParams): WoonbehoefteReportFilter {
  const startYearValues = splitValues(form.getAll('startYear'));
  const search = form.get('search')?.trim();

  return {
    statuses: splitValues(form.getAll('status')).filter(isCaseStatus),
    startYears: startYearValues.filter((value) => value !== START_YEAR_NOT_SET_VALUE).map(Number).filter(Number.isInteger),
    startYearNotSet: startYearValues.includes(START_YEAR_NOT_SET_VALUE),
    applicantTypes: splitValues(form.getAll('applicantType')).filter(isApplicantType),
    assignment: form.get('assignment') === 'unclaimed' ? 'UNCLAIMED' : 'ALL',
    checkRequestedOnly: form.get('check') === 'requested',
    ...(search ? { search } : {}),
  };
}

/** Sorts/dedupes every array field so two independently-built filters with the same effective values always compare equal. */
export function canonicalReportFilter(filter: WoonbehoefteReportFilter): WoonbehoefteReportFilter {
  return {
    statuses: [...new Set(filter.statuses)].sort(),
    startYears: [...new Set(filter.startYears)].sort((a, b) => a - b),
    startYearNotSet: filter.startYearNotSet,
    applicantTypes: [...new Set(filter.applicantTypes)].sort(),
    assignment: filter.assignment,
    checkRequestedOnly: filter.checkRequestedOnly,
    ...(filter.search ? { search: filter.search } : {}),
  };
}

export function reportFiltersEqual(a: WoonbehoefteReportFilter, b: WoonbehoefteReportFilter): boolean {
  return JSON.stringify(canonicalReportFilter(a)) === JSON.stringify(canonicalReportFilter(b));
}

/**
 * Adapts a report filter to the existing overview filter shape so the report feature reuses
 * matchesOverviewFilter verbatim instead of a second copy of the same matching logic. visibleCount is
 * unused by the matcher itself (only by the overview's own pagination), so its value here is irrelevant.
 */
export function toOverviewFilter(filter: WoonbehoefteReportFilter): WoonbehoefteOverviewFilter {
  return { ...filter, visibleCount: 0 };
}

/**
 * actorEmail is always undefined here: MINE cannot occur on WoonbehoefteReportFilter, so the matcher's
 * only actorEmail-dependent branch is unreachable.
 */
export function matchesReportFilter(entry: WoonbehoefteCaseWithSource, filter: WoonbehoefteReportFilter): boolean {
  return matchesOverviewFilter(entry, toOverviewFilter(filter), undefined);
}
