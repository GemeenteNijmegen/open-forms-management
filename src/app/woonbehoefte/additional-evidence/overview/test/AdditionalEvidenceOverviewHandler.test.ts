import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../../shared/authorization/PermissionEvaluator';
import { AdditionalEvidenceRepository, AdditionalEvidenceWorkItem } from '../../persistence/AdditionalEvidenceRepository';
import { AdditionalEvidenceSourceCacheStore } from '../../source/AdditionalEvidenceSourceCacheStore';
import { AdditionalEvidenceOverviewHandler } from '../AdditionalEvidenceOverviewHandler';

function makeAuthorizationService(grants: { resource: string; actions: string[] }[]): AuthorizationService {
  const evaluator = new PermissionEvaluator(grants);
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'employee-1' }, evaluator }),
    requireAuthorization: jest.fn().mockImplementation(async (context, check) => (evaluator.evaluate(check) === 'ALLOW'
      ? undefined
      : { statusCode: 403 })),
  } as unknown as AuthorizationService;
}

function makeRepository(workItems: AdditionalEvidenceWorkItem[]): AdditionalEvidenceRepository {
  return { listWorkItems: jest.fn().mockResolvedValue(workItems) } as unknown as AdditionalEvidenceRepository;
}

function makeSourceCacheStore(): AdditionalEvidenceSourceCacheStore {
  return { getState: jest.fn().mockResolvedValue(undefined) } as unknown as AdditionalEvidenceSourceCacheStore;
}

const workItem: AdditionalEvidenceWorkItem = {
  objectUuid: 'uuid-1',
  submissionReference: 'OF-EXTRA01',
  status: 'NEW',
  originalCaseReference: 'OF-HOOFD01',
  submittedAt: '2026-09-07T17:54:04.702Z',
  createdAt: '2026-09-07T18:00:00.000Z',
  createdBy: 'additional-evidence-sync-worker',
};

describe('AdditionalEvidenceOverviewHandler', () => {
  it('renders the Extra bewijzen tab as active and an empty state for a medewerker with woonbehoefte:view', async () => {
    const handler = new AdditionalEvidenceOverviewHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['view'] }]), makeRepository([]), makeSourceCacheStore(),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('woonbehoefte-tabs__link--active');
    expect(response.body).toContain('Nog geen extra bewijzen bekend.');
  });

  it('lists an ingested workitem with its own kenmerk, opgegeven hoofdzaakkenmerk and status', async () => {
    const handler = new AdditionalEvidenceOverviewHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['view'] }]), makeRepository([workItem]), makeSourceCacheStore(),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.body).toContain('OF-EXTRA01');
    expect(response.body).toContain('OF-HOOFD01');
    expect(response.body).toContain('Nieuw');
  });

  it('denies a medewerker without woonbehoefte:view', async () => {
    const handler = new AdditionalEvidenceOverviewHandler(makeAuthorizationService([]), makeRepository([]), makeSourceCacheStore());

    const response = await handler.handleRequest({ principalId: 'employee-2' }, undefined);

    expect(response.statusCode).toBe(403);
  });
});
