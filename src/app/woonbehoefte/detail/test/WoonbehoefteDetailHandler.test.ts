import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { AdditionalEvidenceSourceCacheStore } from '../../additional-evidence/source/AdditionalEvidenceSourceCacheStore';
import { WoonbehoefteCaseItems, WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { WoonbehoefteCase } from '../../domain/WoonbehoefteCase';
import { WoonbehoefteSourceFailure } from '../../domain/WoonbehoefteSource';
import { WoonbehoefteSourceCacheStore } from '../../source/WoonbehoefteSourceCacheStore';
import { WoonbehoefteDetailHandler } from '../WoonbehoefteDetailHandler';

function noAdditionalSourceCacheStore(): AdditionalEvidenceSourceCacheStore {
  return { getItems: jest.fn().mockResolvedValue(new Map()) } as unknown as AdditionalEvidenceSourceCacheStore;
}

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
    const handler = new WoonbehoefteDetailHandler(
      makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient, noAdditionalSourceCacheStore(),
    );

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
    const handler = new WoonbehoefteDetailHandler(
      makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient, noAdditionalSourceCacheStore(),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, 'OF-1', undefined);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Bijlagen (1)');
    expect(response.body).toContain('bewijsstuk.jpeg');
  });

  it('shows a gekoppelde extra-bewijzeninzending as its own documentgroep, without touching the primary aanvraaggegevens', async () => {
    const caseItems: WoonbehoefteCaseItems = {
      woonbehoefteCase: makeCase(),
      sourceLinks: [
        { caseReference: 'OF-1', submissionId: 'uuid-1', submissionReference: 'OF-1', relation: 'PRIMARY', linkedAt: '2026-08-01T00:00:00.000Z' },
        {
          caseReference: 'OF-1',
          submissionId: 'uuid-extra-01',
          submissionReference: 'OF-EXTRA01',
          relation: 'ADDITIONAL',
          linkedAt: '2026-09-09T10:32:00.000Z',
          linkedBy: 'medewerker@example.invalid',
        },
      ],
      notes: [],
      activities: [],
    };
    const caseRepository = { getCaseItems: jest.fn().mockResolvedValue(caseItems) } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = { getItems: jest.fn().mockResolvedValue(new Map()) } as unknown as WoonbehoefteSourceCacheStore;
    const additionalSourceCacheStore = {
      getItems: jest.fn().mockResolvedValue(new Map([
        ['uuid-extra-01', {
          status: 'READY',
          cacheVersion: 1,
          objectUuid: 'uuid-extra-01',
          submissionId: 'uuid-extra-01',
          reference: 'OF-EXTRA01',
          formName: 'Extra bewijzen stroomaansluiting woningbouw',
          submittedAt: '2026-09-07T17:54:04.702Z',
          originalCaseReference: 'OF-1',
          attachments: [{ documentId: 'extra-doc-a', url: 'https://example.invalid/extra-doc-a', role: 'ATTACHMENT' }],
          cachedAt: '2026-09-07T18:00:00.000Z',
        }],
      ])),
    } as unknown as AdditionalEvidenceSourceCacheStore;
    const openZaakClient = { getDocumentMetadata: jest.fn().mockResolvedValue({ bestandsnaam: 'bewijs.pdf' }) } as unknown as OpenZaakClient;
    const handler = new WoonbehoefteDetailHandler(
      makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient, additionalSourceCacheStore,
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, 'OF-1', undefined);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Extra bewijzen - OF-EXTRA01');
    expect(response.body).toContain('bewijs.pdf');
    // Mustache HTML-escapes {{downloadHref}} (including the slashes, as every other downloadHref in this template already does),
    // so the rendered attribute is not a literal match; the href itself is already covered at the loader level.
    expect(response.body).toContain('extra-doc-a');
    // Primary blijft "Onbekend project": er is geen primary source in deze test, additional links mogen dat niet aanvullen.
    expect(response.body).toContain('Onbekend project');
  });
});
