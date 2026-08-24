import { resolveWoonbehoefteOverviewFilter, sanitizeWoonbehoefteFilterQuery, serializeWoonbehoefteOverviewFilter } from '../WoonbehoefteOverviewFilter';

describe('resolveWoonbehoefteOverviewFilter', () => {
  it('is unfiltered when no query parameters are present', () => {
    const filter = resolveWoonbehoefteOverviewFilter(undefined);

    expect(filter).toEqual({
      statuses: [], startYears: [], startYearNotSet: false, applicantTypes: [], assignment: 'ALL', checkRequestedOnly: false,
    });
  });

  it('parses multi-select checkboxes joined by API Gateway into comma-separated values', () => {
    const filter = resolveWoonbehoefteOverviewFilter({ status: 'NEW,IN_PROGRESS', applicantType: 'INDIVIDUAL,MUNICIPALITY_NIJMEGEN' });

    expect(filter.statuses).toEqual(['NEW', 'IN_PROGRESS']);
    expect(filter.applicantTypes).toEqual(['INDIVIDUAL', 'MUNICIPALITY_NIJMEGEN']);
  });

  it('drops unknown status/applicantType values instead of throwing', () => {
    const filter = resolveWoonbehoefteOverviewFilter({ status: 'NEW,NOT_A_STATUS', applicantType: 'NOT_A_TYPE' });

    expect(filter.statuses).toEqual(['NEW']);
    expect(filter.applicantTypes).toEqual([]);
  });

  it('separates the "nog niet vastgesteld" start-year marker from real years', () => {
    const filter = resolveWoonbehoefteOverviewFilter({ startYear: '2028,nog-niet-vastgesteld,2030' });

    expect(filter.startYears).toEqual([2028, 2030]);
    expect(filter.startYearNotSet).toBe(true);
  });

  it('maps the assignment radio value to MINE/UNCLAIMED/ALL', () => {
    expect(resolveWoonbehoefteOverviewFilter({ assignment: 'mine' }).assignment).toBe('MINE');
    expect(resolveWoonbehoefteOverviewFilter({ assignment: 'unclaimed' }).assignment).toBe('UNCLAIMED');
    expect(resolveWoonbehoefteOverviewFilter({ assignment: 'all' }).assignment).toBe('ALL');
  });

  it('trims search input and drops it entirely when blank', () => {
    expect(resolveWoonbehoefteOverviewFilter({ search: '  OF-ABC123  ' }).search).toBe('OF-ABC123');
    expect(resolveWoonbehoefteOverviewFilter({ search: '   ' }).search).toBeUndefined();
  });
});

describe('serializeWoonbehoefteOverviewFilter / sanitizeWoonbehoefteFilterQuery', () => {
  it('round-trips a filter through serialize and resolve unchanged', () => {
    const filter = resolveWoonbehoefteOverviewFilter({
      status: 'NEW,IN_PROGRESS', startYear: '2028,nog-niet-vastgesteld', applicantType: 'INDIVIDUAL', assignment: 'mine', check: 'requested', search: 'dukenburg',
    });

    const roundTripped = resolveWoonbehoefteOverviewFilter(Object.fromEntries(new URLSearchParams(serializeWoonbehoefteOverviewFilter(filter))));

    expect(roundTripped).toEqual(filter);
  });

  it('produces an empty string for an unfiltered overview', () => {
    expect(serializeWoonbehoefteOverviewFilter(resolveWoonbehoefteOverviewFilter(undefined))).toBe('');
  });

  it('sanitizes a raw/tampered query string down to only known filter keys and values', () => {
    const sanitized = sanitizeWoonbehoefteFilterQuery('status=NEW&returnUrl=https://evil.example&applicantType=NOT_A_TYPE');

    expect(sanitized).toBe('status=NEW');
    expect(sanitized).not.toContain('evil.example');
  });

  it('sanitizes an empty/missing raw query to an empty string', () => {
    expect(sanitizeWoonbehoefteFilterQuery(undefined)).toBe('');
    expect(sanitizeWoonbehoefteFilterQuery('')).toBe('');
  });
});
