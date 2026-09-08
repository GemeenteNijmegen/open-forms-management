import {
  ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION, AdditionalEvidenceSourceItem, AdditionalEvidenceSourceRecord,
} from '../../domain/AdditionalEvidenceSource';
import { AdditionalEvidenceWorkItem } from '../../persistence/AdditionalEvidenceRepository';
import { buildAdditionalEvidenceOverviewViewModel, joinWorkItemsWithSources } from '../AdditionalEvidenceOverviewViewModel';

function workItem(overrides: Partial<AdditionalEvidenceWorkItem> & { objectUuid: string }): AdditionalEvidenceWorkItem {
  return {
    submissionReference: `OF-${overrides.objectUuid}`,
    status: 'NEW',
    createdAt: '2026-09-07T18:00:00.000Z',
    createdBy: 'additional-evidence-sync-worker',
    ...overrides,
  };
}

function sourceRecord(
  overrides: Partial<AdditionalEvidenceSourceRecord> & { objectUuid: string; submittedAt: string },
): AdditionalEvidenceSourceRecord {
  return {
    status: 'READY',
    cacheVersion: ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION,
    submissionId: overrides.objectUuid,
    reference: `OF-${overrides.objectUuid}`,
    formName: 'Extra bewijzen stroomaansluiting woningbouw',
    originalCaseReference: 'OF-HOOFD01',
    attachments: [],
    cachedAt: '2026-09-07T18:00:00.000Z',
    ...overrides,
  };
}

describe('joinWorkItemsWithSources', () => {
  it('marks a workitem with a FAILED source as a technical bronfout, never a workflow status', () => {
    const items = new Map<string, AdditionalEvidenceSourceItem>([
      ['uuid-1', { status: 'FAILED', objectUuid: 'uuid-1', failureReasonCode: 'CSV_FETCH_ERROR', lastAttemptAt: '2026-09-07T18:05:00.000Z' }],
    ]);

    const [entry] = joinWorkItemsWithSources([workItem({ objectUuid: 'uuid-1' })], items);

    expect(entry.sourceError).toBe(true);
    expect(entry.source).toBeUndefined();
    expect(entry.workItem.status).toBe('NEW');
  });

  it('shows a workitem without any source item yet (race just after creation) as unavailable, not as an error', () => {
    const [entry] = joinWorkItemsWithSources([workItem({ objectUuid: 'uuid-1' })], new Map());

    expect(entry.sourceError).toBe(false);
    expect(entry.source).toBeUndefined();
  });
});

describe('buildAdditionalEvidenceOverviewViewModel', () => {
  it('sorts newest submittedAt first', () => {
    const entries = joinWorkItemsWithSources(
      [workItem({ objectUuid: 'uuid-old' }), workItem({ objectUuid: 'uuid-new' })],
      new Map<string, AdditionalEvidenceSourceItem>([
        ['uuid-old', sourceRecord({ objectUuid: 'uuid-old', submittedAt: '2026-09-01T00:00:00.000Z' })],
        ['uuid-new', sourceRecord({ objectUuid: 'uuid-new', submittedAt: '2026-09-08T00:00:00.000Z' })],
      ]),
    );

    const viewModel = buildAdditionalEvidenceOverviewViewModel(entries, { statuses: [] }, '');

    expect(viewModel.rows.map((row) => row.submissionReference)).toEqual(['OF-uuid-new', 'OF-uuid-old']);
  });

  it('filters out non-matching statuses but keeps LINKED visible when no filter is set', () => {
    const entries = joinWorkItemsWithSources(
      [workItem({ objectUuid: 'uuid-1', status: 'NEW' }), workItem({ objectUuid: 'uuid-2', status: 'LINKED' })],
      new Map<string, AdditionalEvidenceSourceItem>([
        ['uuid-1', sourceRecord({ objectUuid: 'uuid-1', submittedAt: '2026-09-01T00:00:00.000Z' })],
        ['uuid-2', sourceRecord({ objectUuid: 'uuid-2', submittedAt: '2026-09-02T00:00:00.000Z' })],
      ]),
    );

    const unfiltered = buildAdditionalEvidenceOverviewViewModel(entries, { statuses: [] }, '');
    expect(unfiltered.rows).toHaveLength(2);

    const filtered = buildAdditionalEvidenceOverviewViewModel(entries, { statuses: ['NEW'] }, '');
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0].submissionReference).toBe('OF-uuid-1');
  });

  it('matches search on projectnaam, opgegeven hoofdzaakkenmerk or de eigen extra-bewijzenreferentie, case-insensitive and partial', () => {
    const entries = joinWorkItemsWithSources(
      [workItem({ objectUuid: 'uuid-1', submissionReference: 'OF-EXTRA01' })],
      new Map<string, AdditionalEvidenceSourceItem>([
        ['uuid-1', sourceRecord({
          objectUuid: 'uuid-1', submittedAt: '2026-09-01T00:00:00.000Z', submittedProjectName: 'Project Lindenhof', originalCaseReference: 'OF-HOOFD01',
        })],
      ]),
    );

    expect(buildAdditionalEvidenceOverviewViewModel(entries, { statuses: [], search: 'lindenhof' }, '').rows).toHaveLength(1);
    expect(buildAdditionalEvidenceOverviewViewModel(entries, { statuses: [], search: 'HOOFD01' }, '').rows).toHaveLength(1);
    expect(buildAdditionalEvidenceOverviewViewModel(entries, { statuses: [], search: 'extra01' }, '').rows).toHaveLength(1);
    expect(buildAdditionalEvidenceOverviewViewModel(entries, { statuses: [], search: 'geen-match' }, '').rows).toHaveLength(0);
  });

  it('carries the search value back into the viewmodel so the input keeps its value', () => {
    const viewModel = buildAdditionalEvidenceOverviewViewModel([], { statuses: [], search: 'lindenhof' }, '');

    expect(viewModel.search).toBe('lindenhof');
  });
});
