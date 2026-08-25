import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { WoonbehoefteCase } from '../../domain/WoonbehoefteCase';
import { WoonbehoefteSourceCacheStore } from '../../source/WoonbehoefteSourceCacheStore';
import { WoonbehoefteOverviewHandler } from '../WoonbehoefteOverviewHandler';

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
    const handler = new WoonbehoefteOverviewHandler(makeAuthorizationService(), caseRepository, sourceCacheStore);

    const response = await handler.handleRequest({ principalId: 'employee-1' }, { assignment: 'mine' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('OF-1');
  });
});
