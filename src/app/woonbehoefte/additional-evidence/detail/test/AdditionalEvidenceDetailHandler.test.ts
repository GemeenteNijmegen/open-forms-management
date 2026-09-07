import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../../shared/authorization/PermissionEvaluator';
import { OpenZaakClient } from '../../../../../shared/clients/open-zaak/OpenZaakClient';
import { ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION, AdditionalEvidenceSourceRecord } from '../../domain/AdditionalEvidenceSource';
import { AdditionalEvidenceRepository, AdditionalEvidenceWorkItem } from '../../persistence/AdditionalEvidenceRepository';
import { AdditionalEvidenceSourceCacheStore } from '../../source/AdditionalEvidenceSourceCacheStore';
import { AdditionalEvidenceDetailHandler } from '../AdditionalEvidenceDetailHandler';

function makeAuthorizationService(): AuthorizationService {
  const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['view'] }]);
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'medewerker' }, evaluator }),
    requireAuthorization: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuthorizationService;
}

function workItem(overrides: Partial<AdditionalEvidenceWorkItem> = {}): AdditionalEvidenceWorkItem {
  return {
    objectUuid: 'uuid-1',
    submissionReference: 'OF-EXTRA01',
    status: 'NEW',
    createdAt: '2026-09-07T18:00:00.000Z',
    createdBy: 'additional-evidence-sync-worker',
    ...overrides,
  };
}

function source(overrides: Partial<AdditionalEvidenceSourceRecord> = {}): AdditionalEvidenceSourceRecord {
  return {
    status: 'READY',
    cacheVersion: ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION,
    objectUuid: 'uuid-1',
    submissionId: 'uuid-1',
    reference: 'OF-EXTRA01',
    formName: 'Extra bewijzen stroomaansluiting woningbouw',
    submittedAt: '2026-09-07T17:54:04.702Z',
    originalCaseReference: 'OF-HOOFD01',
    attachments: [],
    cachedAt: '2026-09-07T18:00:00.000Z',
    ...overrides,
  };
}

describe('AdditionalEvidenceDetailHandler', () => {
  it('returns 404 for an unknown submissionId', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(undefined) } as unknown as AdditionalEvidenceRepository;
    const sourceCacheStore = { getItems: jest.fn() } as unknown as AdditionalEvidenceSourceCacheStore;
    const openZaakClient = { getDocumentMetadata: jest.fn() } as unknown as OpenZaakClient;
    const handler = new AdditionalEvidenceDetailHandler(makeAuthorizationService(), repository, sourceCacheStore, openZaakClient);

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'uuid-missing', undefined);

    expect(response.statusCode).toBe(404);
    expect(sourceCacheStore.getItems).not.toHaveBeenCalled();
  });

  it('renders the submission with its current source data', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(workItem()) } as unknown as AdditionalEvidenceRepository;
    const sourceCacheStore = {
      getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', source({ submittedProjectName: 'Project Lindenhof' })]])),
    } as unknown as AdditionalEvidenceSourceCacheStore;
    const openZaakClient = { getDocumentMetadata: jest.fn() } as unknown as OpenZaakClient;
    const handler = new AdditionalEvidenceDetailHandler(makeAuthorizationService(), repository, sourceCacheStore, openZaakClient);

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'uuid-1', undefined);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('OF-EXTRA01');
    expect(response.body).toContain('Project Lindenhof');
    expect(response.body).toContain('OF-HOOFD01');
  });

  it('still renders when the source is missing entirely (race just after workitem creation), with a bronfout warning', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(workItem()) } as unknown as AdditionalEvidenceRepository;
    const sourceCacheStore = { getItems: jest.fn().mockResolvedValue(new Map()) } as unknown as AdditionalEvidenceSourceCacheStore;
    const openZaakClient = { getDocumentMetadata: jest.fn() } as unknown as OpenZaakClient;
    const handler = new AdditionalEvidenceDetailHandler(makeAuthorizationService(), repository, sourceCacheStore, openZaakClient);

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'uuid-1', undefined);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('nog niet beschikbaar');
  });
});
