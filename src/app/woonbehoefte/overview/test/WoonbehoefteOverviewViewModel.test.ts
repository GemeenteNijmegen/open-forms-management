import { WoonbehoefteCase } from '../../domain/WoonbehoefteCase';
import { WoonbehoefteSourceRecord } from '../../domain/WoonbehoefteSource';
import { resolveWoonbehoefteOverviewFilter } from '../WoonbehoefteOverviewFilter';
import { buildWoonbehoefteOverviewViewModel, joinCasesWithSources } from '../WoonbehoefteOverviewViewModel';

function makeCase(overrides: Partial<WoonbehoefteCase> = {}): WoonbehoefteCase {
  return {
    caseReference: 'OF-1',
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

function makeSource(overrides: Partial<WoonbehoefteSourceRecord> = {}): WoonbehoefteSourceRecord {
  return {
    status: 'READY',
    cacheVersion: 1,
    objectUuid: 'uuid-1',
    submissionId: 'uuid-1',
    submissionType: 'PRIMARY_APPLICATION',
    reference: 'OF-1',
    caseReference: 'OF-1',
    formName: 'Aanmelden stroomaansluiting woningbouw',
    registrationAt: '2026-08-01T10:00:00.000Z',
    applicantType: 'UNKNOWN',
    attachments: [],
    cachedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('WoonbehoefteOverviewViewModel', () => {
  it('never silently picks one source when two primary submissions share the same OF-reference: marks it a conflict instead', () => {
    const entries = joinCasesWithSources(
      [makeCase({ caseReference: 'OF-dup' })],
      [
        makeSource({ caseReference: 'OF-dup', submissionId: 'uuid-a', projectName: 'Project A' }),
        makeSource({ caseReference: 'OF-dup', submissionId: 'uuid-b', reference: 'OF-dup', projectName: 'Project B' }),
      ],
    );

    expect(entries[0].hasSourceConflict).toBe(true);
    expect(entries[0].source).toBeUndefined();

    const viewModel = buildWoonbehoefteOverviewViewModel(entries, resolveWoonbehoefteOverviewFilter(undefined), undefined);
    expect(viewModel.rows[0].hasSourceConflict).toBe(true);
    expect(viewModel.rows[0].projectName).toContain('Bronconflict');
  });

  it('shows a case even when its primary source is not (yet) cached, with a fallback project label', () => {
    const entries = joinCasesWithSources([makeCase({ caseReference: 'OF-nosource' })], []);
    const viewModel = buildWoonbehoefteOverviewViewModel(entries, resolveWoonbehoefteOverviewFilter(undefined), undefined);

    expect(viewModel.rows).toHaveLength(1);
    expect(viewModel.rows[0].projectName).toContain('bron nog niet beschikbaar');
    expect(viewModel.rows[0].receivedLabel).toBe('-');
  });

  it('filters to only the caller\'s own claims, and separately to only unclaimed cases', () => {
    const entries = joinCasesWithSources([
      makeCase({ caseReference: 'OF-mine', claimedBy: 'medewerker@example.nl' }),
      makeCase({ caseReference: 'OF-other', claimedBy: 'ander@example.nl' }),
      makeCase({ caseReference: 'OF-unclaimed' }),
    ], []);

    const mineFilter = resolveWoonbehoefteOverviewFilter({ assignment: 'mine' });
    const mineViewModel = buildWoonbehoefteOverviewViewModel(entries, mineFilter, 'medewerker@example.nl');
    expect(mineViewModel.rows.map((r) => r.caseReference)).toEqual(['OF-mine']);

    const unclaimedFilter = resolveWoonbehoefteOverviewFilter({ assignment: 'unclaimed' });
    const unclaimedViewModel = buildWoonbehoefteOverviewViewModel(entries, unclaimedFilter, 'medewerker@example.nl');
    expect(unclaimedViewModel.rows.map((r) => r.caseReference)).toEqual(['OF-unclaimed']);
  });

  it('searches case-insensitively across OF-nummer, project and contact fields', () => {
    const entries = joinCasesWithSources(
      [makeCase({ caseReference: 'OF-ABC123' }), makeCase({ caseReference: 'OF-OTHER' })],
      [makeSource({ caseReference: 'OF-ABC123', projectName: 'Nieuwbouwproject Dukenburg' }), makeSource({ caseReference: 'OF-OTHER', reference: 'OF-OTHER' })],
    );

    const filter = resolveWoonbehoefteOverviewFilter({ search: 'dukenburg' });
    const viewModel = buildWoonbehoefteOverviewViewModel(entries, filter, undefined);

    expect(viewModel.rows.map((r) => r.caseReference)).toEqual(['OF-ABC123']);
  });

  it('filters on assessedStartPeriod year, and separately on "nog niet vastgesteld"', () => {
    const entries = joinCasesWithSources([
      makeCase({ caseReference: 'OF-2028', assessment: { assessedStartPeriod: 202803 } }),
      makeCase({ caseReference: 'OF-2030', assessment: { assessedStartPeriod: 203001 } }),
      makeCase({ caseReference: 'OF-unset' }),
    ], []);

    const yearFilter = resolveWoonbehoefteOverviewFilter({ startYear: '2028' });
    expect(buildWoonbehoefteOverviewViewModel(entries, yearFilter, undefined).rows.map((r) => r.caseReference)).toEqual(['OF-2028']);

    const notSetFilter = resolveWoonbehoefteOverviewFilter({ startYear: 'nog-niet-vastgesteld' });
    expect(buildWoonbehoefteOverviewViewModel(entries, notSetFilter, undefined).rows.map((r) => r.caseReference)).toEqual(['OF-unset']);
  });

  it('sorts newest submission first', () => {
    const entries = joinCasesWithSources(
      [makeCase({ caseReference: 'OF-old' }), makeCase({ caseReference: 'OF-new' })],
      [
        makeSource({ caseReference: 'OF-old', reference: 'OF-old', registrationAt: '2026-01-01T00:00:00.000Z' }),
        makeSource({ caseReference: 'OF-new', reference: 'OF-new', registrationAt: '2026-08-01T00:00:00.000Z' }),
      ],
    );

    const viewModel = buildWoonbehoefteOverviewViewModel(entries, resolveWoonbehoefteOverviewFilter(undefined), undefined);

    expect(viewModel.rows.map((r) => r.caseReference)).toEqual(['OF-new', 'OF-old']);
  });

  it('filters on check gevraagd', () => {
    const entries = joinCasesWithSources([
      makeCase({ caseReference: 'OF-check', check: { requested: true } }),
      makeCase({ caseReference: 'OF-nocheck', check: { requested: false } }),
    ], []);

    const filter = resolveWoonbehoefteOverviewFilter({ check: 'requested' });
    expect(buildWoonbehoefteOverviewViewModel(entries, filter, undefined).rows.map((r) => r.caseReference)).toEqual(['OF-check']);
  });

  it('filters on applicantType: an unknown source never matches a specific type filter', () => {
    const entries = joinCasesWithSources([
      makeCase({ caseReference: 'OF-individual' }),
      makeCase({ caseReference: 'OF-unknown-source' }),
    ], [makeSource({ caseReference: 'OF-individual', applicantType: 'INDIVIDUAL' })]);

    const filter = resolveWoonbehoefteOverviewFilter({ applicantType: 'INDIVIDUAL' });
    expect(buildWoonbehoefteOverviewViewModel(entries, filter, undefined).rows.map((r) => r.caseReference)).toEqual(['OF-individual']);
  });

  it('paginates: only the first 30 render by default, with an offset revealing more', () => {
    const entries = joinCasesWithSources(
      Array.from({ length: 35 }, (_, index) => makeCase({ caseReference: `OF-${index}` })), [],
    );

    const firstPage = buildWoonbehoefteOverviewViewModel(entries, resolveWoonbehoefteOverviewFilter(undefined), undefined);
    expect(firstPage.rows).toHaveLength(30);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextOffset).toBe(30);

    const secondPage = buildWoonbehoefteOverviewViewModel(entries, resolveWoonbehoefteOverviewFilter(undefined), undefined, 30);
    expect(secondPage.rows).toHaveLength(35);
    expect(secondPage.hasMore).toBe(false);
  });
});
