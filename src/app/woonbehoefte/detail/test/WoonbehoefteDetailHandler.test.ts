import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { WoonbehoefteCaseItems, WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { WoonbehoefteCase } from '../../domain/WoonbehoefteCase';
import { WoonbehoefteSourceCacheStore } from '../../source/WoonbehoefteSourceCacheStore';
import { WoonbehoefteDetailHandler } from '../WoonbehoefteDetailHandler';

function makeCase(overrides: Partial<WoonbehoefteCase> = {}): WoonbehoefteCase {
  return {
    caseReference: 'OF-1',
    status: 'IN_PROGRESS',
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
  const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['manage'] }]);
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'employee-1' }, evaluator }),
    requireAuthorization: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuthorizationService;
}

describe('WoonbehoefteDetailHandler', () => {
  it('recognizes a case claimed by the viewer\'s own principalId as their own claim, even without an email', async () => {
    const caseItems: WoonbehoefteCaseItems = {
      woonbehoefteCase: makeCase({ claimedBy: 'employee-1' }), sourceLinks: [], notes: [], activities: [],
    };
    const caseRepository = { getCaseItems: jest.fn().mockResolvedValue(caseItems) } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = { getItems: jest.fn() } as unknown as WoonbehoefteSourceCacheStore;
    const openZaakClient = {} as unknown as OpenZaakClient;
    const handler = new WoonbehoefteDetailHandler(makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient);

    const response = await handler.handleRequest({ principalId: 'employee-1' }, 'OF-1', undefined);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Claim vrijgeven');
  });
});
