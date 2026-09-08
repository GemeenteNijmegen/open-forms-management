import { OVERVIEW_PAGE_SIZE, serializeWoonbehoefteOverviewFilter, WoonbehoefteAssignmentFilter, WoonbehoefteOverviewFilter } from './WoonbehoefteOverviewFilter';
import { logger } from '../../../observability/Logger';
import { APPLICANT_TYPE_LABELS, CASE_STATUS_LABELS, PROJECT_READINESS_LABELS } from '../domain/CaseLabels';
import { CASE_STATUSES, CaseStatus } from '../domain/CaseStatus';
import { WoonbehoefteCase } from '../domain/WoonbehoefteCase';
import { formatDutchDateTime, formatPeriodLabel, periodYear } from '../domain/WoonbehoefteFormatting';
import { APPLICANT_TYPES, ApplicantType, WoonbehoefteSourceRecord } from '../domain/WoonbehoefteSource';

export interface WoonbehoefteCaseWithSource {
  woonbehoefteCase: WoonbehoefteCase;
  source?: WoonbehoefteSourceRecord;
  /** Slight chance, but True when more than one primary source shares this case's OF-reference; the case's own SOURCE#PRIMARY link (see detail) is the real truth, never guessed here. */
  hasSourceConflict?: boolean;
}

/**
 * Joins every case to its primary source record in memory; a case without one yet still shows, with
 * fallback labels. `caseReference` should be unique per primary source, but an unexpected duplicate
 * OF-reference is a genuine data conflict: never silently pick one, mark it instead. The
 * detail page always resolves the real source through the case's own SOURCE#PRIMARY link, not this map.
 */
export function joinCasesWithSources(cases: WoonbehoefteCase[], sources: WoonbehoefteSourceRecord[]): WoonbehoefteCaseWithSource[] {
  const sourceByCaseReference = new Map<string, WoonbehoefteSourceRecord>();
  const conflictedCaseReferences = new Set<string>();

  for (const source of sources) {
    if (source.submissionType !== 'PRIMARY_APPLICATION') {
      continue;
    }
    const existing = sourceByCaseReference.get(source.caseReference);
    if (existing && existing.submissionId !== source.submissionId) {
      conflictedCaseReferences.add(source.caseReference);
      logger.warn('Woonbehoefte overview: duplicate OF-reference across primary sources, not guessing which one is correct', {
        caseReference: source.caseReference,
      });
      continue;
    }
    sourceByCaseReference.set(source.caseReference, source);
  }

  return cases.map((woonbehoefteCase) => (
    conflictedCaseReferences.has(woonbehoefteCase.caseReference)
      ? { woonbehoefteCase, source: undefined, hasSourceConflict: true }
      : { woonbehoefteCase, source: sourceByCaseReference.get(woonbehoefteCase.caseReference) }
  ));
}

/** Newest primary registration first; a case without a source sorts last (empty string is the lowest possible value). */
export function compareByRegistrationAtDesc(a: WoonbehoefteCaseWithSource, b: WoonbehoefteCaseWithSource): number {
  return (b.source?.registrationAt ?? '').localeCompare(a.source?.registrationAt ?? '');
}

export function matchesOverviewFilter(
  entry: WoonbehoefteCaseWithSource, filter: WoonbehoefteOverviewFilter, actorEmail: string | undefined,
): boolean {
  const { woonbehoefteCase, source } = entry;

  if (filter.statuses.length > 0 && !filter.statuses.includes(woonbehoefteCase.status)) {
    return false;
  }

  if (filter.startYears.length > 0 || filter.startYearNotSet) {
    const year = periodYear(woonbehoefteCase.assessment.assessedStartPeriod);
    const matchesYear = year !== undefined && filter.startYears.includes(year);
    const matchesNotSet = filter.startYearNotSet && year === undefined;
    if (!matchesYear && !matchesNotSet) {
      return false;
    }
  }

  if (filter.applicantTypes.length > 0 && !filter.applicantTypes.includes(source?.applicantType ?? 'UNKNOWN')) {
    return false;
  }

  if (filter.assignment === 'MINE' && woonbehoefteCase.claimedBy !== actorEmail) {
    return false;
  }
  if (filter.assignment === 'UNCLAIMED' && woonbehoefteCase.claimedBy !== undefined) {
    return false;
  }

  if (filter.checkRequestedOnly && !woonbehoefteCase.check.requested) {
    return false;
  }

  if (filter.search) {
    const needle = filter.search.toLowerCase();
    const haystack = [
      woonbehoefteCase.caseReference, source?.projectName, source?.contactName, source?.contactEmail,
    ].filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase());
    if (!haystack.some((value) => value.includes(needle))) {
      return false;
    }
  }

  return true;
}

export interface WoonbehoefteOverviewRow {
  caseReference: string;
  detailHref: string;
  statusLabel: string;
  statusToken: string;
  projectName: string;
  hasSourceConflict: boolean;
  receivedLabel: string;
  statusSinceLabel: string;
  applicantTypeLabel: string;
  isCollectiveHousing: boolean;
  assigneeLabel: string;
  isUnclaimed: boolean;
  startPeriodLabel: string;
  readinessLabel: string;
  checkRequested: boolean;
}

export function buildOverviewRow(entry: WoonbehoefteCaseWithSource, backQuery: string): WoonbehoefteOverviewRow {
  const { woonbehoefteCase, source, hasSourceConflict } = entry;
  const readiness = woonbehoefteCase.assessment.assessedProjectReadiness;
  const detailHref = `/woonbehoefte/cases/${encodeURIComponent(woonbehoefteCase.caseReference)}${backQuery ? `?back=${encodeURIComponent(backQuery)}` : ''}`;
  return {
    caseReference: woonbehoefteCase.caseReference,
    detailHref,
    statusLabel: CASE_STATUS_LABELS[woonbehoefteCase.status],
    statusToken: woonbehoefteCase.status.toLowerCase().replace(/_/g, '-'),
    projectName: hasSourceConflict
      ? 'Bronconflict: meerdere aanvragen met dit OF-nummer'
      : source?.projectName ?? 'Onbekend project (bron nog niet beschikbaar)',
    hasSourceConflict: hasSourceConflict === true,
    receivedLabel: source ? formatDutchDateTime(source.registrationAt) : '-',
    statusSinceLabel: formatDutchDateTime(woonbehoefteCase.statusChangedAt),
    applicantTypeLabel: APPLICANT_TYPE_LABELS[source?.applicantType ?? 'UNKNOWN'],
    isCollectiveHousing: source?.isCollectiveHousing === true,
    assigneeLabel: woonbehoefteCase.claimedBy ?? 'Ongeclaimd',
    isUnclaimed: woonbehoefteCase.claimedBy === undefined,
    startPeriodLabel: formatPeriodLabel(woonbehoefteCase.assessment.assessedStartPeriod),
    readinessLabel: readiness ? PROJECT_READINESS_LABELS[readiness] : 'Nog niet vastgesteld',
    checkRequested: woonbehoefteCase.check.requested,
  };
}

export interface WoonbehoefteFilterOption {
  value: string;
  label: string;
  checked: boolean;
}

export interface WoonbehoefteOverviewViewModel {
  rows: WoonbehoefteOverviewRow[];
  hasRows: boolean;
  totalCountLabel: string;
  statusOptions: WoonbehoefteFilterOption[];
  applicantTypeOptions: WoonbehoefteFilterOption[];
  startYearOptions: WoonbehoefteFilterOption[];
  hasStartYearOptions: boolean;
  startYearNotSetChecked: boolean;
  assignmentAll: boolean;
  assignmentMine: boolean;
  assignmentUnclaimed: boolean;
  checkRequestedOnly: boolean;
  search: string;
  hasMore: boolean;
  nextVisibleCount?: number;
  backQuery: string;
}

export function buildWoonbehoefteOverviewViewModel(
  entries: WoonbehoefteCaseWithSource[], filter: WoonbehoefteOverviewFilter, actorEmail: string | undefined,
): WoonbehoefteOverviewViewModel {
  const matched = entries
    .filter((entry) => matchesOverviewFilter(entry, filter, actorEmail))
    .sort(compareByRegistrationAtDesc);

  const availableStartYears = [...new Set(
    entries.map((e) => periodYear(e.woonbehoefteCase.assessment.assessedStartPeriod)).filter((y): y is number => y !== undefined),
  )].sort((a, b) => a - b);

  const backQuery = serializeWoonbehoefteOverviewFilter(filter);
  const page = matched.slice(0, filter.visibleCount);

  return {
    rows: page.map((entry) => buildOverviewRow(entry, backQuery)),
    hasRows: matched.length > 0,
    totalCountLabel: `${matched.length} ${matched.length === 1 ? 'aanvraag' : 'aanvragen'}`,
    statusOptions: CASE_STATUSES.map((status) => statusOption(status, filter)),
    applicantTypeOptions: APPLICANT_TYPES.map((type) => applicantTypeOption(type, filter)),
    startYearOptions: availableStartYears.map((year) => ({
      value: String(year), label: String(year), checked: filter.startYears.includes(year),
    })),
    hasStartYearOptions: availableStartYears.length > 0,
    startYearNotSetChecked: filter.startYearNotSet,
    assignmentAll: filter.assignment === 'ALL',
    assignmentMine: filter.assignment === 'MINE',
    assignmentUnclaimed: filter.assignment === 'UNCLAIMED',
    checkRequestedOnly: filter.checkRequestedOnly,
    search: filter.search ?? '',
    hasMore: page.length < matched.length,
    ...(page.length < matched.length ? { nextVisibleCount: filter.visibleCount + OVERVIEW_PAGE_SIZE } : {}),
    backQuery,
  };
}

function statusOption(status: CaseStatus, filter: WoonbehoefteOverviewFilter): WoonbehoefteFilterOption {
  return { value: status, label: CASE_STATUS_LABELS[status], checked: filter.statuses.includes(status) };
}

function applicantTypeOption(applicantType: ApplicantType, filter: WoonbehoefteOverviewFilter): WoonbehoefteFilterOption {
  return { value: applicantType, label: APPLICANT_TYPE_LABELS[applicantType], checked: filter.applicantTypes.includes(applicantType) };
}

export type { WoonbehoefteAssignmentFilter };
