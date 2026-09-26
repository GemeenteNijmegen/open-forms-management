import { readFileSync } from 'fs';
import { join } from 'path';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { WOONBEHOEFTE_SOURCE_CACHE_VERSION, WoonbehoefteSourceItem, WoonbehoefteSourceRecord } from '../../domain/WoonbehoefteSource';
import { WoonbehoefteSourceCacheStore } from '../../source/WoonbehoefteSourceCacheStore';
import { initializeCase, ProjectDetailsInitializationDependencies, runProjectDetailsBatch } from '../initialization/ProjectDetailsInitializationRunner';
import { NewWorkVersionInput, ProjectDetailsStore } from '../persistence/ProjectDetailsStore';

const CATEGORY_1_SAMPLE = readFileSync(
  join(__dirname, '../../source/test/samples/woonbehoefte-submission-category-1.csv'), 'utf-8',
);

function readySource(csvUrl: string): WoonbehoefteSourceRecord {
  return {
    status: 'READY',
    cacheVersion: WOONBEHOEFTE_SOURCE_CACHE_VERSION,
    objectUuid: 'uuid-1',
    submissionId: 'uuid-1',
    submissionType: 'PRIMARY_APPLICATION',
    reference: 'OF-1',
    caseReference: 'OF-1',
    formName: 'Aanmelden stroomaansluiting woningbouw',
    registrationAt: '2026-08-01T00:00:00.000Z',
    applicantType: 'UNKNOWN',
    attachments: [],
    cachedAt: '2026-08-01T00:00:00.000Z',
    csvDocument: { documentId: 'doc-1', url: csvUrl, role: 'CSV' },
  };
}

function makeDeps(overrides: Partial<{
  workVersionExists: boolean;
  sourceLinks: { relation: 'PRIMARY' | 'ADDITIONAL'; submissionId: string }[];
  sourceItem: WoonbehoefteSourceItem | undefined;
  csvText: string | Error;
  createResult: 'CREATED' | 'SKIPPED';
}> = {}): { deps: ProjectDetailsInitializationDependencies; store: { setAttempt: jest.Mock; createWorkVersionIfMissing: jest.Mock } } {
  const store = {
    getWorkVersion: jest.fn().mockResolvedValue(overrides.workVersionExists ? { caseReference: 'OF-1' } : undefined),
    setAttempt: jest.fn().mockResolvedValue(undefined),
    createWorkVersionIfMissing: jest.fn().mockResolvedValue(overrides.createResult ?? 'CREATED'),
    recordBatchState: jest.fn().mockResolvedValue(undefined),
  };
  const caseRepository = {
    getSourceLinks: jest.fn().mockResolvedValue(overrides.sourceLinks ?? [{ relation: 'PRIMARY', submissionId: 'uuid-1' }]),
    listCases: jest.fn().mockResolvedValue([{ caseReference: 'OF-1' }]),
  } as unknown as WoonbehoefteCaseRepository;
  const sourceItem = 'sourceItem' in overrides ? overrides.sourceItem : readySource('csv://ok');
  const sourceCacheStore = {
    getItems: jest.fn().mockResolvedValue(new Map(sourceItem ? [['uuid-1', sourceItem]] : [])),
  } as unknown as WoonbehoefteSourceCacheStore;
  const openZaakClient = {
    getDocumentText: jest.fn().mockImplementation(async () => {
      if (overrides.csvText instanceof Error) {
        throw overrides.csvText;
      }
      return overrides.csvText ?? CATEGORY_1_SAMPLE;
    }),
  } as unknown as OpenZaakClient;

  return {
    deps: { caseRepository, sourceCacheStore, openZaakClient, store: store as unknown as ProjectDetailsStore },
    store,
  };
}

describe('initializeCase', () => {
  it('does not fetch anything and returns SKIPPED when a werkversie already exists', async () => {
    const { deps, store } = makeDeps({ workVersionExists: true });

    const result = await initializeCase('OF-1', deps);

    expect(result).toBe('SKIPPED');
    expect(store.setAttempt).not.toHaveBeenCalled();
  });

  it('marks PENDING before fetching, then CREATED on a successful parse', async () => {
    const { deps, store } = makeDeps();

    const result = await initializeCase('OF-1', deps);

    expect(result).toBe('CREATED');
    expect(store.setAttempt).toHaveBeenCalledWith('OF-1', 'PENDING', undefined, expect.any(Date));
    const [, input] = store.createWorkVersionIfMissing.mock.calls[0] as [string, NewWorkVersionInput];
    expect(input.readableProjectName).toBe('Voorbeeldproject');
  });

  it('fails a case without a primary source link, without ever calling Open Zaak', async () => {
    const { deps, store } = makeDeps({ sourceLinks: [] });

    const result = await initializeCase('OF-1', deps);

    expect(result).toBe('FAILED');
    expect(store.setAttempt).toHaveBeenLastCalledWith('OF-1', 'FAILED', 'MISSING_SOURCE_LINK', expect.any(Date));
    expect((deps.openZaakClient.getDocumentText as jest.Mock)).not.toHaveBeenCalled();
  });

  it('fails a case whose cached source has no CSV document', async () => {
    const { deps, store } = makeDeps({ sourceItem: undefined });

    const result = await initializeCase('OF-1', deps);

    expect(result).toBe('FAILED');
    expect(store.setAttempt).toHaveBeenLastCalledWith('OF-1', 'FAILED', 'MISSING_SOURCE_CSV', expect.any(Date));
  });

  it('fails when the CSV fetch itself throws, without crashing the caller', async () => {
    const { deps, store } = makeDeps({ csvText: new Error('Open Zaak unavailable') });

    const result = await initializeCase('OF-1', deps);

    expect(result).toBe('FAILED');
    expect(store.setAttempt).toHaveBeenLastCalledWith('OF-1', 'FAILED', 'CSV_FETCH_ERROR', expect.any(Date));
  });

  it('fails on a corrupt CSV without throwing to the caller', async () => {
    const { deps, store } = makeDeps({ csvText: 'Formuliernaam\ncorrupt\n' });

    const result = await initializeCase('OF-1', deps);

    expect(result).toBe('FAILED');
    expect(store.setAttempt).toHaveBeenLastCalledWith('OF-1', 'FAILED', 'CSV_PARSE_ERROR', expect.any(Date));
  });

  it('treats a race where the werkversie was created in between as SKIPPED, not CREATED', async () => {
    const { deps } = makeDeps({ createResult: 'SKIPPED' });

    const result = await initializeCase('OF-1', deps);

    expect(result).toBe('SKIPPED');
  });

  it('fails the case instead of throwing when reading the source link itself blows up', async () => {
    const { deps, store } = makeDeps();
    (deps.caseRepository.getSourceLinks as jest.Mock).mockRejectedValue(new Error('DynamoDB unavailable'));

    const result = await initializeCase('OF-1', deps);

    expect(result).toBe('FAILED');
    expect(store.setAttempt).toHaveBeenLastCalledWith('OF-1', 'FAILED', 'UNEXPECTED_ERROR', expect.any(Date));
  });
});

describe('runProjectDetailsBatch', () => {
  it('reports created/skipped/failed counts without an Objects-scan, only existing CASE-items', async () => {
    const { deps } = makeDeps();

    const outcome = await runProjectDetailsBatch(deps, () => false, 'run-1');

    expect(outcome).toMatchObject({ created: 1, skipped: 0, failed: 0, cutoffReached: false });
  });

  it('stops starting new work past the cutoff and reports it, without failing the cases it never reached', async () => {
    const { deps } = makeDeps();
    (deps.caseRepository.listCases as jest.Mock).mockResolvedValue([{ caseReference: 'OF-1' }, { caseReference: 'OF-2' }]);

    const outcome = await runProjectDetailsBatch(deps, () => true, 'run-1');

    expect(outcome.cutoffReached).toBe(true);
    expect(outcome.created + outcome.skipped + outcome.failed).toBe(0);
  });

  it('a second batch run after a medewerker edited the werkversie never recreates or overwrites it', async () => {
    const { deps, store } = makeDeps();
    store.getWorkVersion
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ caseReference: 'OF-1', readableProjectName: 'Door medewerker aangepast' });

    const firstRun = await runProjectDetailsBatch(deps, () => false, 'run-1');
    const secondRun = await runProjectDetailsBatch(deps, () => false, 'run-2');

    expect(firstRun).toMatchObject({ created: 1, skipped: 0, failed: 0 });
    expect(secondRun).toMatchObject({ created: 0, skipped: 1, failed: 0 });
    expect(store.createWorkVersionIfMissing).toHaveBeenCalledTimes(1);
  });

  it('records a visible RUNNING state up front and a final CUTOFF state so an incomplete run can be recognized and resumed', async () => {
    const { deps, store } = makeDeps() as unknown as { deps: ProjectDetailsInitializationDependencies; store: { recordBatchState: jest.Mock } };

    await runProjectDetailsBatch(deps, () => true, 'run-1');

    expect(store.recordBatchState).toHaveBeenNthCalledWith(1, expect.objectContaining({ runId: 'run-1', status: 'RUNNING' }));
    expect(store.recordBatchState).toHaveBeenNthCalledWith(2, expect.objectContaining({ runId: 'run-1', status: 'CUTOFF' }));
  });
});
