import { WoonbehoefteCase } from '../../../domain/WoonbehoefteCase';
import { WoonbehoefteSourceRecord } from '../../../domain/WoonbehoefteSource';
import { matchesOverviewFilter, WoonbehoefteCaseWithSource } from '../../../overview/WoonbehoefteOverviewViewModel';
import {
  canonicalReportFilter, matchesReportFilter, resolveWoonbehoefteReportFilter, reportFiltersEqual, WoonbehoefteReportFilter,
} from '../WoonbehoefteReportFilter';

function woonbehoefteCase(overrides: Partial<WoonbehoefteCase> & { caseReference: string }): WoonbehoefteCase {
  return {
    status: 'NEW',
    statusChangedAt: '2026-08-01T00:00:00.000Z',
    assessment: {},
    check: { requested: false },
    version: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    createdBy: 'woonbehoefte-sync-worker',
    updatedAt: '2026-08-01T00:00:00.000Z',
    updatedBy: 'woonbehoefte-sync-worker',
    ...overrides,
  };
}

function source(overrides: Partial<WoonbehoefteSourceRecord> & { caseReference: string }): WoonbehoefteSourceRecord {
  return {
    status: 'READY',
    cacheVersion: 1,
    objectUuid: `uuid-${overrides.caseReference}`,
    submissionId: `uuid-${overrides.caseReference}`,
    submissionType: 'PRIMARY_APPLICATION',
    reference: overrides.caseReference,
    formName: 'Aanmelden stroomaansluiting woningbouw',
    registrationAt: '2026-08-20T10:15:00.000Z',
    applicantType: 'UNKNOWN',
    attachments: [],
    cachedAt: '2026-08-20T10:15:00.000Z',
    ...overrides,
  };
}

// A representative mix: claimed/unclaimed, different statuses/startYears/applicantTypes/check state, one without a source.
const entries: WoonbehoefteCaseWithSource[] = [
  {
    woonbehoefteCase: woonbehoefteCase({
      caseReference: 'OF-1', status: 'NEW', claimedBy: 'medewerker@nijmegen.nl', assessment: { assessedStartPeriod: 202803 },
    }),
    source: source({ caseReference: 'OF-1', applicantType: 'INDIVIDUAL', projectName: 'Project Een' }),
  },
  {
    woonbehoefteCase: woonbehoefteCase({ caseReference: 'OF-2', status: 'IN_PROGRESS', check: { requested: true } }),
    source: source({ caseReference: 'OF-2', applicantType: 'PROJECT_APPLICANT', projectName: 'Project Twee' }),
  },
  {
    woonbehoefteCase: woonbehoefteCase({ caseReference: 'OF-3', status: 'READY_FOR_RANKING', assessment: { assessedStartPeriod: 202901 } }),
    source: source({ caseReference: 'OF-3', applicantType: 'MUNICIPALITY_NIJMEGEN', projectName: 'Project Drie' }),
  },
  { woonbehoefteCase: woonbehoefteCase({ caseReference: 'OF-4', status: 'INADMISSIBLE' }), source: undefined },
];

interface Scenario {
  name: string;
  reportFilter: WoonbehoefteReportFilter;
}

const emptyFilter: WoonbehoefteReportFilter = {
  statuses: [], startYears: [], startYearNotSet: false, applicantTypes: [], assignment: 'ALL', checkRequestedOnly: false,
};

const scenarios: Scenario[] = [
  { name: 'no filter at all', reportFilter: emptyFilter },
  { name: 'filtered by status', reportFilter: { ...emptyFilter, statuses: ['NEW', 'IN_PROGRESS'] } },
  { name: 'filtered by applicant type', reportFilter: { ...emptyFilter, applicantTypes: ['PROJECT_APPLICANT'] } },
  { name: 'filtered by start year', reportFilter: { ...emptyFilter, startYears: [2028] } },
  { name: 'filtered by unclaimed', reportFilter: { ...emptyFilter, assignment: 'UNCLAIMED' } },
  { name: 'filtered by check requested', reportFilter: { ...emptyFilter, checkRequestedOnly: true } },
  { name: 'filtered by search', reportFilter: { ...emptyFilter, search: 'Twee' } },
];

describe('matchesReportFilter equivalence with the regular overview matcher', () => {
  it.each(scenarios)('matches exactly the same entries as matchesOverviewFilter for: $name', ({ reportFilter }) => {
    const overviewFilter = { ...reportFilter, visibleCount: 0 } as const;
    const reportResult = entries.filter((entry) => matchesReportFilter(entry, reportFilter)).map((e) => e.woonbehoefteCase.caseReference);
    const overviewResult = entries
      .filter((entry) => matchesOverviewFilter(entry, overviewFilter, undefined))
      .map((e) => e.woonbehoefteCase.caseReference);
    expect(reportResult).toEqual(overviewResult);
  });
});

describe('resolveWoonbehoefteReportFilter', () => {
  it('reads repeated form fields, not a comma-joined single value', () => {
    const form = new URLSearchParams();
    form.append('status', 'NEW');
    form.append('status', 'IN_PROGRESS');
    form.append('applicantType', 'INDIVIDUAL');
    form.append('startYear', '2028');
    form.append('startYear', 'nog-niet-vastgesteld');

    const filter = resolveWoonbehoefteReportFilter(form);

    expect(filter.statuses).toEqual(['NEW', 'IN_PROGRESS']);
    expect(filter.applicantTypes).toEqual(['INDIVIDUAL']);
    expect(filter.startYears).toEqual([2028]);
    expect(filter.startYearNotSet).toBe(true);
  });

  it('never resolves assignment to anything other than ALL or UNCLAIMED, even if the form claims "mine"', () => {
    const form = new URLSearchParams({ assignment: 'mine' });
    expect(resolveWoonbehoefteReportFilter(form).assignment).toBe('ALL');
  });

  it('drops unknown status/applicantType values instead of rejecting the request', () => {
    const form = new URLSearchParams();
    form.append('status', 'NOT_A_REAL_STATUS');
    form.append('applicantType', 'NOT_A_REAL_TYPE');
    const filter = resolveWoonbehoefteReportFilter(form);
    expect(filter.statuses).toEqual([]);
    expect(filter.applicantTypes).toEqual([]);
  });

  it('trims search and omits it entirely when blank', () => {
    expect(resolveWoonbehoefteReportFilter(new URLSearchParams({ search: '  Lindenhof  ' })).search).toBe('Lindenhof');
    expect(resolveWoonbehoefteReportFilter(new URLSearchParams({ search: '   ' })).search).toBeUndefined();
  });
});

describe('canonicalReportFilter / reportFiltersEqual', () => {
  it('treats the same values in a different array order as equal', () => {
    const a: WoonbehoefteReportFilter = { ...emptyFilter, statuses: ['NEW', 'IN_PROGRESS'], applicantTypes: ['PROJECT_APPLICANT', 'INDIVIDUAL'] };
    const b: WoonbehoefteReportFilter = { ...emptyFilter, statuses: ['IN_PROGRESS', 'NEW'], applicantTypes: ['INDIVIDUAL', 'PROJECT_APPLICANT'] };
    expect(reportFiltersEqual(a, b)).toBe(true);
  });

  it('treats a different value as not equal', () => {
    const a: WoonbehoefteReportFilter = { ...emptyFilter, statuses: ['NEW'] };
    const b: WoonbehoefteReportFilter = { ...emptyFilter, statuses: ['IN_PROGRESS'] };
    expect(reportFiltersEqual(a, b)).toBe(false);
  });

  it('dedupes repeated values', () => {
    const filter = canonicalReportFilter({ ...emptyFilter, statuses: ['NEW', 'NEW'] });
    expect(filter.statuses).toEqual(['NEW']);
  });
});
