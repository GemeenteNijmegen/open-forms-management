import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { WoonbehoefteCase } from '../../domain/WoonbehoefteCase';
import { ProjectDetailsStore } from '../../project-details/persistence/ProjectDetailsStore';
import { RankingStore } from '../../ranking/RankingStore';
import { WoonbehoefteSourceCacheStore } from '../../source/WoonbehoefteSourceCacheStore';
import { WoonbehoefteOverviewHandler } from '../WoonbehoefteOverviewHandler';

function noRanking(): RankingStore {
  return { getCurrentList: jest.fn().mockResolvedValue(undefined) } as unknown as RankingStore;
}

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

function makeAuthorizationService(): AuthorizationService {
  const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['view'] }]);
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'employee-1' }, evaluator }),
    requireAuthorization: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuthorizationService;
}

describe('WoonbehoefteOverviewHandler', () => {
  it('matches "Door mij" on principalId when the identity has no email, the same actor-id every mutation handler uses for claimedBy', async () => {
    const caseRepository = {
      listCases: jest.fn().mockResolvedValue([makeCase({ claimedBy: 'employee-1' })]),
    } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = {
      readReadySubmissions: jest.fn().mockResolvedValue({ submissions: [], failedMarkers: [] }),
      getState: jest.fn().mockResolvedValue(undefined),
    } as unknown as WoonbehoefteSourceCacheStore;
    const projectDetailsStore = { getBatchState: jest.fn().mockResolvedValue(undefined) } as unknown as ProjectDetailsStore;
    const handler = new WoonbehoefteOverviewHandler(makeAuthorizationService(), caseRepository, sourceCacheStore, projectDetailsStore, noRanking());

    const response = await handler.handleRequest({ principalId: 'employee-1' }, { assignment: 'mine' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('OF-1');
  });

  it('keeps rendering the werkvoorraad when only the projectdetails batchstatus read fails', async () => {
    const caseRepository = { listCases: jest.fn().mockResolvedValue([makeCase()]) } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = {
      readReadySubmissions: jest.fn().mockResolvedValue({ submissions: [], failedMarkers: [] }),
      getState: jest.fn().mockResolvedValue(undefined),
    } as unknown as WoonbehoefteSourceCacheStore;
    const projectDetailsStore = {
      getBatchState: jest.fn().mockRejectedValue(new Error('DynamoDB unavailable')),
    } as unknown as ProjectDetailsStore;
    const handler = new WoonbehoefteOverviewHandler(makeAuthorizationService(), caseRepository, sourceCacheStore, projectDetailsStore, noRanking());

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('OF-1');
  });

  it('keeps rendering the werkvoorraad when only the ranking read fails', async () => {
    const caseRepository = { listCases: jest.fn().mockResolvedValue([makeCase()]) } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = {
      readReadySubmissions: jest.fn().mockResolvedValue({ submissions: [], failedMarkers: [] }),
      getState: jest.fn().mockResolvedValue(undefined),
    } as unknown as WoonbehoefteSourceCacheStore;
    const projectDetailsStore = { getBatchState: jest.fn().mockResolvedValue(undefined) } as unknown as ProjectDetailsStore;
    const brokenRankingStore = { getCurrentList: jest.fn().mockRejectedValue(new Error('DynamoDB unavailable')) } as unknown as RankingStore;
    const handler = new WoonbehoefteOverviewHandler(
      makeAuthorizationService(), caseRepository, sourceCacheStore, projectDetailsStore, brokenRankingStore,
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('OF-1');
    expect(response.body).toContain('Rang: –');
  });

  function makeHandlerWithBatchState(batchState: unknown): WoonbehoefteOverviewHandler {
    const caseRepository = { listCases: jest.fn().mockResolvedValue([makeCase()]) } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = {
      readReadySubmissions: jest.fn().mockResolvedValue({ submissions: [], failedMarkers: [] }),
      getState: jest.fn().mockResolvedValue(undefined),
    } as unknown as WoonbehoefteSourceCacheStore;
    const projectDetailsStore = { getBatchState: jest.fn().mockResolvedValue(batchState) } as unknown as ProjectDetailsStore;
    return new WoonbehoefteOverviewHandler(makeAuthorizationService(), caseRepository, sourceCacheStore, projectDetailsStore, noRanking());
  }

  it('shows a recent RUNNING batch as still running', async () => {
    const handler = makeHandlerWithBatchState({ runId: 'run-1', status: 'RUNNING', startedAt: new Date().toISOString() });

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.body).toContain('Projectdetails-batch loopt nog');
    expect(response.body).not.toContain('niet aantoonbaar afgerond');
  });

  it('shows a RUNNING batch older than the Lambda-timeout as stale, with a hint to restart', async () => {
    const staleStartedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const handler = makeHandlerWithBatchState({ runId: 'run-1', status: 'RUNNING', startedAt: staleStartedAt });

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.body).toContain('niet aantoonbaar afgerond');
    expect(response.body).not.toContain('Projectdetails-batch loopt nog');
  });

  it('keeps showing a CUTOFF batch with its resume hint, unaffected by the stale-RUNNING check', async () => {
    const handler = makeHandlerWithBatchState({
      runId: 'run-1', status: 'CUTOFF', startedAt: '2026-09-25T10:00:00.000Z', completedAt: '2026-09-25T10:13:00.000Z', created: 3, skipped: 1, failed: 0,
    });

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.body).toContain('Niet alle dossiers zijn verwerkt');
  });

  it('keeps a READY_WITH_ERRORS batch as a visible warning alert', async () => {
    const handler = makeHandlerWithBatchState({
      runId: 'run-1',
      status: 'READY_WITH_ERRORS',
      startedAt: '2026-09-25T10:00:00.000Z',
      completedAt: '2026-09-25T10:13:00.000Z',
      created: 3,
      skipped: 1,
      failed: 2,
    });

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.body).toContain('utrecht-alert--warning');
    expect(response.body).toContain('2 mislukt');
  });

  it('shows a clean READY batch only in a closed samenvatting, never as a permanent alert', async () => {
    const handler = makeHandlerWithBatchState({
      runId: 'run-1', status: 'READY', startedAt: '2026-09-25T10:00:00.000Z', completedAt: '2026-09-25T10:13:00.000Z', created: 23, skipped: 2, failed: 0,
    });

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.body).toContain('Laatste projectdetails-batch');
    expect(response.body).toContain('23 aangemaakt');
    expect(response.body).not.toContain('utrecht-alert--success');
    expect(response.body).not.toContain('utrecht-alert--warning');
    // Closed by default: no open attribute right after the details tag that wraps the summary.
    expect(response.body).not.toMatch(/<details class="woonbehoefte-details" open/);
  });

  it('never breaks on a READY batch without a completedAt', async () => {
    const handler = makeHandlerWithBatchState({ runId: 'run-1', status: 'READY', startedAt: '2026-09-25T10:00:00.000Z', created: 1, skipped: 0, failed: 0 });

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Laatste projectdetails-batch');
    expect(response.body).not.toContain('Afgerond op');
  });
});
