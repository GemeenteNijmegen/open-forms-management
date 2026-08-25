import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { WoonbehoefteCaseRepository, WoonbehoefteCaseItems } from '../../cases/WoonbehoefteCaseRepository';
import { WoonbehoefteSourceFailure, WoonbehoefteSourceRecord } from '../../domain/WoonbehoefteSource';
import { WoonbehoefteSourceCacheStore } from '../../source/WoonbehoefteSourceCacheStore';
import { WoonbehoefteDocumentDownloadHandler } from '../WoonbehoefteDocumentDownloadHandler';

jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));

const bucketName = 'test-woonbehoefte-downloads';

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

function makeFailedSource(overrides: Partial<WoonbehoefteSourceFailure> = {}): WoonbehoefteSourceFailure {
  return {
    status: 'FAILED',
    objectUuid: 'uuid-1',
    reference: 'OF-A',
    submissionType: 'PRIMARY_APPLICATION',
    failureReasonCode: 'CSV_FETCH_ERROR',
    lastAttemptAt: '2026-08-01T10:00:00.000Z',
    attachments: [{ documentId: 'doc-a', url: 'https://example.invalid/doc-a', role: 'ATTACHMENT' }],
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

function makeS3Client(): S3Client {
  return { send: jest.fn().mockResolvedValue({}) } as unknown as S3Client;
}

describe('WoonbehoefteDocumentDownloadHandler', () => {
  beforeEach(() => {
    (getSignedUrl as jest.Mock).mockReset().mockResolvedValue('https://signed.example.invalid/downloads/doc-a');
  });

  it('refuses a documentId from a different case: no content, no S3 staging', async () => {
    const caseRepository = { getCaseItems: jest.fn().mockResolvedValue(caseItems('OF-B', 'uuid-b')) } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = {
      getItems: jest.fn().mockResolvedValue(new Map([
        ['uuid-b', makeSource({ caseReference: 'OF-B', reference: 'OF-B', objectUuid: 'uuid-b', submissionId: 'uuid-b', attachments: [] })],
      ])),
    } as unknown as WoonbehoefteSourceCacheStore;
    const openZaakClient = { getDocumentContent: jest.fn() } as unknown as OpenZaakClient;
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const s3Client = makeS3Client();

    const handler = new WoonbehoefteDocumentDownloadHandler(
      makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient, auditTrail, s3Client, bucketName,
    );
    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-B', 'doc-a');

    expect(response.statusCode).toBe(404);
    expect(openZaakClient.getDocumentContent).not.toHaveBeenCalled();
    expect(s3Client.send).not.toHaveBeenCalled();
  });

  it('stages the document in S3 and redirects to a 60-second presigned URL, auditing caseReference+documentId only', async () => {
    const caseRepository = { getCaseItems: jest.fn().mockResolvedValue(caseItems('OF-A', 'uuid-1')) } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = {
      getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', makeSource()]])),
    } as unknown as WoonbehoefteSourceCacheStore;
    const content = { body: new Uint8Array([1, 2, 3]) };
    const openZaakClient = {
      getDocumentContent: jest.fn().mockResolvedValue(content),
      getDocumentMetadata: jest.fn().mockResolvedValue({ bestandsnaam: 'bewijsstuk.jpeg', formaat: 'image/jpeg' }),
    } as unknown as OpenZaakClient;
    const record = jest.fn().mockResolvedValue(undefined);
    const auditTrail = { record } as unknown as AuditTrail;
    const s3Client = makeS3Client();

    const handler = new WoonbehoefteDocumentDownloadHandler(
      makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient, auditTrail, s3Client, bucketName,
    );
    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-A', 'doc-a');

    expect(s3Client.send).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    const putCommand = (s3Client.send as jest.Mock).mock.calls[0][0] as PutObjectCommand;
    expect(putCommand.input).toEqual(expect.objectContaining({
      Bucket: bucketName,
      Key: 'downloads/doc-a',
      Body: content.body,
      ContentType: 'image/jpeg',
      ContentDisposition: 'attachment; filename="bewijsstuk.jpeg"',
      CacheControl: 'private, no-store',
    }));
    expect(getSignedUrl).toHaveBeenCalledWith(s3Client, expect.anything(), { expiresIn: 60 });

    expect(response.statusCode).toBe(302);
    expect(response.headers?.Location).toBe('https://signed.example.invalid/downloads/doc-a');
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
    const s3Client = makeS3Client();

    const handler = new WoonbehoefteDocumentDownloadHandler(
      makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient, auditTrail, s3Client, bucketName,
    );
    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-missing', 'doc-a');

    expect(response.statusCode).toBe(404);
    expect(sourceCacheStore.getItems).not.toHaveBeenCalled();
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
    const s3Client = makeS3Client();

    const handler = new WoonbehoefteDocumentDownloadHandler(
      makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient, auditTrail, s3Client, bucketName,
    );
    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-A', 'doc-a');

    const putCommand = (s3Client.send as jest.Mock).mock.calls[0][0] as PutObjectCommand;
    expect(putCommand.input.ContentType).toBe('application/octet-stream');
    expect(putCommand.input.ContentDisposition).toContain('OF-A-doc-a');
    expect(response.statusCode).toBe(302);
  });

  it('never offers the CSV document for download, even if requested by its documentId', async () => {
    const csvSource = makeSource({ csvDocument: { documentId: 'csv-1', url: 'https://example.invalid/csv-1', role: 'CSV' }, attachments: [] });
    const caseRepository = { getCaseItems: jest.fn().mockResolvedValue(caseItems('OF-A', 'uuid-1')) } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = { getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', csvSource]])) } as unknown as WoonbehoefteSourceCacheStore;
    const openZaakClient = { getDocumentContent: jest.fn() } as unknown as OpenZaakClient;
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const s3Client = makeS3Client();

    const handler = new WoonbehoefteDocumentDownloadHandler(
      makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient, auditTrail, s3Client, bucketName,
    );
    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-A', 'csv-1');

    expect(response.statusCode).toBe(404);
    expect(openZaakClient.getDocumentContent).not.toHaveBeenCalled();
    expect(s3Client.send).not.toHaveBeenCalled();
  });

  it('allows downloading a document a FAILED source still carries (Object envelope was valid, only the CSV failed)', async () => {
    const caseRepository = { getCaseItems: jest.fn().mockResolvedValue(caseItems('OF-A', 'uuid-1')) } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = {
      getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', makeFailedSource()]])),
    } as unknown as WoonbehoefteSourceCacheStore;
    const openZaakClient = {
      getDocumentContent: jest.fn().mockResolvedValue({ body: new Uint8Array([1, 2, 3]) }),
      getDocumentMetadata: jest.fn().mockResolvedValue({ bestandsnaam: 'bewijsstuk.jpeg', formaat: 'image/jpeg' }),
    } as unknown as OpenZaakClient;
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const s3Client = makeS3Client();

    const handler = new WoonbehoefteDocumentDownloadHandler(
      makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient, auditTrail, s3Client, bucketName,
    );
    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-A', 'doc-a');

    expect(response.statusCode).toBe(302);
    expect(openZaakClient.getDocumentContent).toHaveBeenCalled();
  });

  it('refuses an unknown documentId on a FAILED source: still 404, no content fetched', async () => {
    const caseRepository = { getCaseItems: jest.fn().mockResolvedValue(caseItems('OF-A', 'uuid-1')) } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = {
      getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', makeFailedSource()]])),
    } as unknown as WoonbehoefteSourceCacheStore;
    const openZaakClient = { getDocumentContent: jest.fn() } as unknown as OpenZaakClient;
    const auditTrail = { record: jest.fn() } as unknown as AuditTrail;
    const s3Client = makeS3Client();

    const handler = new WoonbehoefteDocumentDownloadHandler(
      makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient, auditTrail, s3Client, bucketName,
    );
    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-A', 'doc-unknown');

    expect(response.statusCode).toBe(404);
    expect(openZaakClient.getDocumentContent).not.toHaveBeenCalled();
  });

  it('returns 500 and skips the success audit when staging in S3 fails', async () => {
    const caseRepository = { getCaseItems: jest.fn().mockResolvedValue(caseItems('OF-A', 'uuid-1')) } as unknown as WoonbehoefteCaseRepository;
    const sourceCacheStore = {
      getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', makeSource()]])),
    } as unknown as WoonbehoefteSourceCacheStore;
    const openZaakClient = {
      getDocumentContent: jest.fn().mockResolvedValue({ body: new Uint8Array([1, 2, 3]) }),
      getDocumentMetadata: jest.fn().mockResolvedValue({ bestandsnaam: 'bewijsstuk.jpeg', formaat: 'image/jpeg' }),
    } as unknown as OpenZaakClient;
    const record = jest.fn().mockResolvedValue(undefined);
    const auditTrail = { record } as unknown as AuditTrail;
    const s3Client = { send: jest.fn().mockRejectedValue(new Error('s3 unavailable')) } as unknown as S3Client;

    const handler = new WoonbehoefteDocumentDownloadHandler(
      makeAuthorizationService(), caseRepository, sourceCacheStore, openZaakClient, auditTrail, s3Client, bucketName,
    );
    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-A', 'doc-a');

    expect(response.statusCode).toBe(500);
    expect(record).not.toHaveBeenCalled();
  });
});
