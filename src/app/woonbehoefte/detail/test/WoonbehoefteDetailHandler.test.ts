import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { WoonbehoefteCaseItems, WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { WoonbehoefteCase } from '../../domain/WoonbehoefteCase';
import { WoonbehoefteSourceFailure } from '../../domain/WoonbehoefteSource';
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

  it('keeps the PDF/attachments a FAILED source still carries visible, even though the case shows a bronfout', async () => {
    const caseItems: WoonbehoefteCaseItems = {
      woonbehoefteCase: makeCase(),
      sourceLinks: [{ caseReference: 'OF-1', submissionId: 'uuid-1', submissionReference: 'OF-1', relation: 'PRIMARY', linkedAt: '2026-08-01T00:00:00.000Z' }],
      notes: [],
      activities: [],
    };
    const failedSource: WoonbehoefteSourceFailure = {
      status: 'FAILED',
      objectUuid: 'uuid-1',
      reference: 'OF-1',
      submissionType: 'PRIMARY_APPLICATION',
      failureReasonCode: 'CSV_FETCH_ERROR',
      lastAttemptAt: '2026-08-01T00:00:00.000Z',
      attachments: [{ documentId: 'doc-a', url: 'https://example.invalid/doc-a', role: 'ATTACHMENT' }],
    };
    const caseRepository = { getCaseItems: jest.fn().mockResolvedValue(caseItems) } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = { getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', failedSource]])) } as unknown as WoonbehoefteSourceCacheStore;
    const openZaakClient = { getDocumentMetadata: jest.fn().mockResolvedValue({ bestandsnaam: 'bewijsstuk.jpeg' }) } as unknown as OpenZaakClient;
    const handler = new WoonbehoefteDetailHandler(makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient);

    const response = await handler.handleRequest({ principalId: 'employee-1' }, 'OF-1', undefined);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Bijlagen (1)');
    expect(response.body).toContain('bewijsstuk.jpeg');
  });
});
