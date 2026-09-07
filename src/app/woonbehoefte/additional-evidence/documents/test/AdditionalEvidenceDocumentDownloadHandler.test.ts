import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AuditTrail } from '../../../../../shared/audit/AuditTrail';
import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../../shared/authorization/PermissionEvaluator';
import { OpenZaakClient } from '../../../../../shared/clients/open-zaak/OpenZaakClient';
import {
  ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION, AdditionalEvidenceSourceFailure, AdditionalEvidenceSourceRecord,
} from '../../domain/AdditionalEvidenceSource';
import { AdditionalEvidenceRepository, AdditionalEvidenceWorkItem } from '../../persistence/AdditionalEvidenceRepository';
import { AdditionalEvidenceSourceCacheStore } from '../../source/AdditionalEvidenceSourceCacheStore';
import { AdditionalEvidenceDocumentDownloadHandler } from '../AdditionalEvidenceDocumentDownloadHandler';

jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));

const bucketName = 'test-woonbehoefte-downloads';

function makeWorkItem(overrides: Partial<AdditionalEvidenceWorkItem> = {}): AdditionalEvidenceWorkItem {
  return {
    objectUuid: 'uuid-1',
    submissionReference: 'OF-EXTRA01',
    status: 'NEW',
    createdAt: '2026-09-07T18:00:00.000Z',
    createdBy: 'additional-evidence-sync-worker',
    ...overrides,
  };
}

function makeSource(overrides: Partial<AdditionalEvidenceSourceRecord> = {}): AdditionalEvidenceSourceRecord {
  return {
    status: 'READY',
    cacheVersion: ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION,
    objectUuid: 'uuid-1',
    submissionId: 'uuid-1',
    reference: 'OF-EXTRA01',
    formName: 'Extra bewijzen stroomaansluiting woningbouw',
    submittedAt: '2026-09-07T17:54:04.702Z',
    originalCaseReference: 'OF-HOOFD01',
    attachments: [{ documentId: 'doc-a', url: 'https://example.invalid/doc-a', role: 'ATTACHMENT' }],
    cachedAt: '2026-09-07T18:00:00.000Z',
    ...overrides,
  };
}

function makeFailedSource(overrides: Partial<AdditionalEvidenceSourceFailure> = {}): AdditionalEvidenceSourceFailure {
  return {
    status: 'FAILED',
    objectUuid: 'uuid-1',
    reference: 'OF-EXTRA01',
    failureReasonCode: 'CSV_FETCH_ERROR',
    lastAttemptAt: '2026-09-07T18:00:00.000Z',
    attachments: [{ documentId: 'doc-a', url: 'https://example.invalid/doc-a', role: 'ATTACHMENT' }],
    ...overrides,
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

describe('AdditionalEvidenceDocumentDownloadHandler', () => {
  beforeEach(() => {
    (getSignedUrl as jest.Mock).mockReset().mockResolvedValue('https://signed.example.invalid/downloads/doc-a');
  });

  it('returns 404 for a submission that does not exist', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(undefined) } as unknown as AdditionalEvidenceRepository;
    const sourceCacheStore = { getItems: jest.fn() } as unknown as AdditionalEvidenceSourceCacheStore;
    const openZaakClient = { getDocumentContent: jest.fn() } as unknown as OpenZaakClient;
    const handler = new AdditionalEvidenceDocumentDownloadHandler(
      makeAuthorizationService(), repository, sourceCacheStore, openZaakClient,
      { record: jest.fn() } as unknown as AuditTrail, makeS3Client(), bucketName,
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'uuid-missing', 'doc-a');

    expect(response.statusCode).toBe(404);
    expect(sourceCacheStore.getItems).not.toHaveBeenCalled();
  });

  it('refuses a documentId not linked to this submission: no content, no S3 staging', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(makeWorkItem()) } as unknown as AdditionalEvidenceRepository;
    const sourceCacheStore = {
      getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', makeSource({ attachments: [] })]])),
    } as unknown as AdditionalEvidenceSourceCacheStore;
    const openZaakClient = { getDocumentContent: jest.fn() } as unknown as OpenZaakClient;
    const s3Client = makeS3Client();
    const handler = new AdditionalEvidenceDocumentDownloadHandler(
      makeAuthorizationService(), repository, sourceCacheStore, openZaakClient, { record: jest.fn() } as unknown as AuditTrail, s3Client, bucketName,
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'uuid-1', 'doc-a');

    expect(response.statusCode).toBe(404);
    expect(openZaakClient.getDocumentContent).not.toHaveBeenCalled();
    expect(s3Client.send).not.toHaveBeenCalled();
  });

  it('never offers the CSV document for download, even if requested by its documentId', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(makeWorkItem()) } as unknown as AdditionalEvidenceRepository;
    const csvSource = makeSource({ csvDocument: { documentId: 'csv-1', url: 'https://example.invalid/csv-1', role: 'CSV' }, attachments: [] });
    const sourceCacheStore = {
      getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', csvSource]])),
    } as unknown as AdditionalEvidenceSourceCacheStore;
    const openZaakClient = { getDocumentContent: jest.fn() } as unknown as OpenZaakClient;
    const s3Client = makeS3Client();
    const handler = new AdditionalEvidenceDocumentDownloadHandler(
      makeAuthorizationService(), repository, sourceCacheStore, openZaakClient, { record: jest.fn() } as unknown as AuditTrail, s3Client, bucketName,
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'uuid-1', 'csv-1');

    expect(response.statusCode).toBe(404);
    expect(openZaakClient.getDocumentContent).not.toHaveBeenCalled();
  });

  it('stages the document in S3 and redirects to a 60-second presigned URL, auditing submissionReference+documentId only', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(makeWorkItem()) } as unknown as AdditionalEvidenceRepository;
    const sourceCacheStore = {
      getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', makeSource()]])),
    } as unknown as AdditionalEvidenceSourceCacheStore;
    const content = { body: new Uint8Array([1, 2, 3]) };
    const openZaakClient = {
      getDocumentContent: jest.fn().mockResolvedValue(content),
      getDocumentMetadata: jest.fn().mockResolvedValue({ bestandsnaam: 'bewijs-1.pdf', formaat: 'application/pdf' }),
    } as unknown as OpenZaakClient;
    const record = jest.fn().mockResolvedValue(undefined);
    const s3Client = makeS3Client();
    const handler = new AdditionalEvidenceDocumentDownloadHandler(
      makeAuthorizationService(), repository, sourceCacheStore, openZaakClient, { record } as unknown as AuditTrail, s3Client, bucketName,
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'uuid-1', 'doc-a');

    expect(s3Client.send).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    expect(getSignedUrl).toHaveBeenCalledWith(s3Client, expect.anything(), { expiresIn: 60 });
    expect(response.statusCode).toBe(302);
    expect(response.headers?.Location).toBe('https://signed.example.invalid/downloads/doc-a');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'WOONBEHOEFTE_DOCUMENT_DOWNLOADED', metadata: { submissionReference: 'OF-EXTRA01', documentId: 'doc-a' },
    }));
  });

  it('allows downloading a document a FAILED source still carries (Object envelope was valid, only the CSV failed)', async () => {
    const repository = { getWorkItem: jest.fn().mockResolvedValue(makeWorkItem()) } as unknown as AdditionalEvidenceRepository;
    const sourceCacheStore = {
      getItems: jest.fn().mockResolvedValue(new Map([['uuid-1', makeFailedSource()]])),
    } as unknown as AdditionalEvidenceSourceCacheStore;
    const openZaakClient = {
      getDocumentContent: jest.fn().mockResolvedValue({ body: new Uint8Array([1, 2, 3]) }),
      getDocumentMetadata: jest.fn().mockResolvedValue({ bestandsnaam: 'bewijs-1.pdf', formaat: 'application/pdf' }),
    } as unknown as OpenZaakClient;
    const handler = new AdditionalEvidenceDocumentDownloadHandler(
      makeAuthorizationService(), repository, sourceCacheStore, openZaakClient,
      { record: jest.fn() } as unknown as AuditTrail, makeS3Client(), bucketName,
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'uuid-1', 'doc-a');

    expect(response.statusCode).toBe(302);
    expect(openZaakClient.getDocumentContent).toHaveBeenCalled();
  });
});
