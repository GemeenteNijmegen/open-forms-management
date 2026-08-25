import { resolveWoonbehoefteOverviewFilter, sanitizeWoonbehoefteFilterQuery, serializeWoonbehoefteOverviewFilter } from '../WoonbehoefteOverviewFilter';

describe('resolveWoonbehoefteOverviewFilter', () => {
  it('is unfiltered when no query parameters are present', () => {
    const filter = resolveWoonbehoefteOverviewFilter(undefined);

    expect(filter).toEqual({
      statuses: [], startYears: [], startYearNotSet: false, applicantTypes: [], assignment: 'ALL', checkRequestedOnly: false, visibleCount: 30,
    });
  });

  it('accepts a valid ?visible= as a whole number of pages', () => {
    expect(resolveWoonbehoefteOverviewFilter({ visible: '60' }).visibleCount).toBe(60);
    expect(resolveWoonbehoefteOverviewFilter({ visible: '990' }).visibleCount).toBe(990);
  });

  it('rounds a non-page-aligned ?visible= down to a whole number of pages', () => {
    expect(resolveWoonbehoefteOverviewFilter({ visible: '45' }).visibleCount).toBe(30);
    expect(resolveWoonbehoefteOverviewFilter({ visible: '61' }).visibleCount).toBe(60);
  });

  it('ignores a negative, non-numeric, or extreme ?visible= and falls back to one page', () => {
    expect(resolveWoonbehoefteOverviewFilter({ visible: '-30' }).visibleCount).toBe(30);
    expect(resolveWoonbehoefteOverviewFilter({ visible: 'not-a-number' }).visibleCount).toBe(30);
    expect(resolveWoonbehoefteOverviewFilter({ visible: '1000000' }).visibleCount).toBe(30);
    expect(resolveWoonbehoefteOverviewFilter({ visible: '0' }).visibleCount).toBe(30);
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

  it('omits ?visible= entirely at the default page size, so a plain overview URL stays clean', () => {
    expect(serializeWoonbehoefteOverviewFilter(resolveWoonbehoefteOverviewFilter({ visible: '30' }))).toBe('');
  });

  it('keeps visible=60 across a detail/back round-trip, alongside other active filters', () => {
    const sanitized = sanitizeWoonbehoefteFilterQuery('status=NEW&visible=60&assignment=mine');

    expect(sanitized).toContain('visible=60');
    expect(sanitized).toContain('status=NEW');
    expect(sanitized).toContain('assignment=mine');
  });

  it('never lets a tampered visible= in a back-form field re-inflate past what resolveWoonbehoefteOverviewFilter allows', () => {
    const sanitized = sanitizeWoonbehoefteFilterQuery('visible=-30');

    expect(sanitized).not.toContain('visible=-30');
    expect(sanitized).toBe('');
  });
});
