import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { WoonbehoefteCaseRepository, WoonbehoefteCaseItems } from '../../cases/WoonbehoefteCaseRepository';
import { WoonbehoefteSourceRecord } from '../../domain/WoonbehoefteSource';
import { WoonbehoefteSourceCacheStore } from '../../source/WoonbehoefteSourceCacheStore';
import { WoonbehoefteDocumentDownloadHandler } from '../WoonbehoefteDocumentDownloadHandler';

function makeSource(overrides: Partial<WoonbehoefteSourceRecord> = {}): WoonbehoefteSourceRecord {
  return {
    status: 'READY',
    cacheVersion: 1,
    objectUuid: 'uuid-1',
    submissionId: 'uuid-1',
    submissionType: 'PRIMARY_APPLICATION',
    reference: 'OF-A',
    caseReference: 'OF-A',
    formName: 'Aanmelden stroomaansluiting woningbouw',
    registrationAt: '2026-08-01T10:00:00.000Z',
    applicantType: 'UNKNOWN',
    attachments: [{ documentId: 'doc-a', url: 'https://example.invalid/doc-a', role: 'ATTACHMENT' }],
    cachedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function caseItems(caseReference: string, submissionId: string): WoonbehoefteCaseItems {
  return {
    woonbehoefteCase: {
      caseReference,
      status: 'IN_PROGRESS',
      statusChangedAt: '2026-08-01T00:00:00.000Z',
      assessment: {},
      check: { requested: false },
      version: 1,
      createdAt: '2026-08-01T00:00:00.000Z',
      createdBy: 'woonbehoefte-sync-worker',
      updatedAt: '2026-08-01T00:00:00.000Z',
      updatedBy: 'woonbehoefte-sync-worker',
    },
    sourceLinks: [{ caseReference, submissionId, submissionReference: caseReference, relation: 'PRIMARY', linkedAt: '2026-08-01T00:00:00.000Z' }],
    notes: [],
    activities: [],
  };
}

function makeAuthorizationService(): AuthorizationService {
  const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['view'] }]);
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'medewerker' }, evaluator }),
    requireAuthorization: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuthorizationService;
}

describe('WoonbehoefteDocumentDownloadHandler', () => {
  it('refuses a documentId from a different case: no content, even though the document exists elsewhere', async () => {
    const caseRepository = { getCaseItems: jest.fn().mockResolvedValue(caseItems('OF-B', 'uuid-b')) } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = {
      getItems: jest.fn().mockResolvedValue(new Map([
        ['uuid-b', makeSource({ caseReference: 'OF-B', reference: 'OF-B', objectUuid: 'uuid-b', submissionId: 'uuid-b', attachments: [] })],
      ])),
    } as unknown as WoonbehoefteSourceCacheStore;
    const openZaakClient = { getDocumentContent: jest.fn() } as unknown as OpenZaakClient;
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;

    const handler = new WoonbehoefteDocumentDownloadHandler(makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient, auditTrail);
    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-B', 'doc-a');

    expect(response.statusCode).toBe(404);
    expect(openZaakClient.getDocumentContent).not.toHaveBeenCalled();
  });

  it('downloads a document that is actually linked to the requested case, and audits caseReference+documentId only', async () => {
    const caseRepository = { getCaseItems: jest.fn().mockResolvedValue(caseItems('OF-A', 'uuid-1')) } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = {
      getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', makeSource()]])),
    } as unknown as WoonbehoefteSourceCacheStore;
    const openZaakClient = { getDocumentContent: jest.fn().mockResolvedValue({ body: new Uint8Array([1, 2, 3]) }) } as unknown as OpenZaakClient;
    const record = jest.fn().mockResolvedValue(undefined);
    const auditTrail = { record } as unknown as AuditTrail;

    const handler = new WoonbehoefteDocumentDownloadHandler(makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient, auditTrail);
    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-A', 'doc-a');

    expect(response.statusCode).toBe(200);
    expect(response.headers?.['Cache-Control']).toBe('private, no-store');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'WOONBEHOEFTE_DOCUMENT_DOWNLOADED', metadata: { caseReference: 'OF-A', documentId: 'doc-a' },
    }));
  });

  it('returns 404 for a case that does not exist', async () => {
    const caseRepository = {
      getCaseItems: jest.fn().mockResolvedValue({ sourceLinks: [], notes: [], activities: [] }),
    } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = { getItems: jest.fn() } as unknown as WoonbehoefteSourceCacheStore;
    const openZaakClient = { getDocumentContent: jest.fn() } as unknown as OpenZaakClient;
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;

    const handler = new WoonbehoefteDocumentDownloadHandler(makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient, auditTrail);
    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-missing', 'doc-a');

    expect(response.statusCode).toBe(404);
    expect(sourceCacheStore.getItems).not.toHaveBeenCalled();
  });

  it('uses the real Open Zaak filename/content-type when metadata is available', async () => {
    const caseRepository = { getCaseItems: jest.fn().mockResolvedValue(caseItems('OF-A', 'uuid-1')) } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = {
      getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', makeSource()]])),
    } as unknown as WoonbehoefteSourceCacheStore;
    const openZaakClient = {
      getDocumentContent: jest.fn().mockResolvedValue({ body: new Uint8Array([1, 2, 3]) }),
      getDocumentMetadata: jest.fn().mockResolvedValue({ bestandsnaam: 'bewijsstuk.jpeg', formaat: 'image/jpeg' }),
    } as unknown as OpenZaakClient;
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;

    const handler = new WoonbehoefteDocumentDownloadHandler(makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient, auditTrail);
    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-A', 'doc-a');

    expect(response.headers?.['Content-Type']).toBe('image/jpeg');
    expect(response.headers?.['Content-Disposition']).toContain('bewijsstuk.jpeg');
  });

  it('falls back to a generic filename/content-type when the metadata call fails, without blocking the download', async () => {
    const caseRepository = { getCaseItems: jest.fn().mockResolvedValue(caseItems('OF-A', 'uuid-1')) } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = {
      getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', makeSource()]])),
    } as unknown as WoonbehoefteSourceCacheStore;
    const openZaakClient = {
      getDocumentContent: jest.fn().mockResolvedValue({ body: new Uint8Array([1, 2, 3]) }),
      getDocumentMetadata: jest.fn().mockRejectedValue(new Error('metadata unavailable')),
    } as unknown as OpenZaakClient;
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;

    const handler = new WoonbehoefteDocumentDownloadHandler(makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient, auditTrail);
    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-A', 'doc-a');

    expect(response.statusCode).toBe(200);
    expect(response.headers?.['Content-Type']).toBe('application/octet-stream');
    expect(response.headers?.['Content-Disposition']).toContain('OF-A-doc-a');
  });

  it('never offers the CSV document for download, even if requested by its documentId', async () => {
    const csvSource = makeSource({ csvDocument: { documentId: 'csv-1', url: 'https://example.invalid/csv-1', role: 'CSV' }, attachments: [] });
    const caseRepository = { getCaseItems: jest.fn().mockResolvedValue(caseItems('OF-A', 'uuid-1')) } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = { getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', csvSource]])) } as unknown as WoonbehoefteSourceCacheStore;
    const openZaakClient = { getDocumentContent: jest.fn() } as unknown as OpenZaakClient;
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;

    const handler = new WoonbehoefteDocumentDownloadHandler(makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient, auditTrail);
    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-A', 'csv-1');

    expect(response.statusCode).toBe(404);
    expect(openZaakClient.getDocumentContent).not.toHaveBeenCalled();
  });
});
