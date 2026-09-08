import { S3Client } from '@aws-sdk/client-s3';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { AdditionalEvidenceSourceCacheStore } from '../../additional-evidence/source/AdditionalEvidenceSourceCacheStore';
import { WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { CaseSourceLink, WoonbehoefteCase } from '../../domain/WoonbehoefteCase';
import { WoonbehoefteSourceRecord } from '../../domain/WoonbehoefteSource';
import { WoonbehoefteSourceCacheStore } from '../../source/WoonbehoefteSourceCacheStore';
import { WoonbehoefteReport } from '../domain/WoonbehoefteReport';
import { WoonbehoefteReportStore } from '../store/WoonbehoefteReportStore';
import { runWoonbehoefteExcelReport, WoonbehoefteExcelWorkerDependencies } from '../WoonbehoefteExcelWorkerRunner';

const filter = { statuses: [], startYears: [], startYearNotSet: false, applicantTypes: [], assignment: 'ALL' as const, checkRequestedOnly: false };

function makeReport(overrides: Partial<WoonbehoefteReport> = {}): WoonbehoefteReport {
  return {
    reportId: 'report-1',
    filter,
    options: { includeAllFormFields: false, includeAttachmentFilenames: false },
    status: 'QUEUED',
    requestedBy: 'medewerker@nijmegen.nl',
    requestedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

function woonbehoefteCase(overrides: Partial<WoonbehoefteCase> & { caseReference: string }): WoonbehoefteCase {
  return {
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

function source(overrides: Partial<WoonbehoefteSourceRecord> & { caseReference: string }): WoonbehoefteSourceRecord {
  return {
    status: 'READY',
    cacheVersion: 1,
    objectUuid: `uuid-${overrides.caseReference}`,
    submissionId: `uuid-${overrides.caseReference}`,
    submissionType: 'PRIMARY_APPLICATION',
    reference: overrides.caseReference,
    formName: 'Aanmelden stroomaansluiting woningbouw',
    registrationAt: '2026-08-20T10:15:00.000Z',
    applicantType: 'INDIVIDUAL',
    attachments: [],
    cachedAt: '2026-08-20T10:15:00.000Z',
    csvDocument: {
      documentId: `doc-${overrides.caseReference}`, url: `https://open-zaak.example.invalid/csv/${overrides.caseReference}`, role: 'CSV',
    },
    ...overrides,
  };
}

function additionalLink(caseReference: string, submissionId: string, linkedAt = '2026-08-22T00:00:00.000Z'): CaseSourceLink {
  return { caseReference, submissionId, submissionReference: 'EB-1', relation: 'ADDITIONAL', linkedAt };
}

function makeDeps(report: WoonbehoefteReport) {
  const getSourceLinks = jest.fn().mockResolvedValue([]);
  const caseRepository = {
    listCases: jest.fn().mockResolvedValue([
      woonbehoefteCase({ caseReference: 'OF-1' }),
      woonbehoefteCase({ caseReference: 'OF-2' }),
    ]),
    getSourceLinks,
  } as unknown as WoonbehoefteCaseRepository;

  const sourceCacheStore = {
    readReadySubmissions: jest.fn().mockResolvedValue({
      submissions: [
        source({ caseReference: 'OF-1', registrationAt: '2026-08-20T10:15:00.000Z' }),
        source({ caseReference: 'OF-2', registrationAt: '2026-08-21T10:15:00.000Z' }),
      ],
      failedMarkers: [],
    }),
  } as unknown as WoonbehoefteSourceCacheStore;

  const additionalSourceCacheStore = {
    getItems: jest.fn().mockResolvedValue(new Map()),
  } as unknown as AdditionalEvidenceSourceCacheStore;

  const getDocumentText = jest.fn().mockResolvedValue('projectNaam\n"Project Een"\n');
  const getDocumentMetadata = jest.fn().mockResolvedValue({ bestandsnaam: 'bijlage.pdf' });
  const openZaakClient = { getDocumentText, getDocumentMetadata } as unknown as OpenZaakClient;

  const s3Send = jest.fn().mockResolvedValue({});
  const s3Client = { send: s3Send } as unknown as S3Client;

  const auditRecord = jest.fn().mockResolvedValue(undefined);
  const auditTrail = { record: auditRecord } as unknown as AuditTrail;

  const store = {
    claimForBuilding: jest.fn().mockResolvedValue(true),
    get: jest.fn().mockResolvedValue(report),
    touchBuilding: jest.fn().mockResolvedValue(undefined),
    markReady: jest.fn().mockResolvedValue(true),
    markTooLarge: jest.fn().mockResolvedValue(true),
    markFailed: jest.fn().mockResolvedValue(true),
  };

  const deps: WoonbehoefteExcelWorkerDependencies = {
    caseRepository,
    sourceCacheStore,
    additionalSourceCacheStore,
    openZaakClient,
    s3Client,
    auditTrail,
    bucketName: 'test-bucket',
    reportStore: store as unknown as WoonbehoefteReportStore,
  };

  return { deps, store, s3Send, auditRecord, caseRepository, sourceCacheStore, additionalSourceCacheStore, getDocumentText, getDocumentMetadata };
}

describe('runWoonbehoefteExcelReport', () => {
  it('claims the report, joins/sorts cases with sources, uploads the Excel file, and marks it READY with the case count', async () => {
    const report = makeReport();
    const { deps, store, s3Send, auditRecord } = makeDeps(report);

    await runWoonbehoefteExcelReport('report-1', deps, () => false, 'trace-1');

    expect(store.claimForBuilding).toHaveBeenCalledWith('report-1');
    expect(s3Send).toHaveBeenCalledTimes(1);
    expect(s3Send.mock.calls[0][0].input).toMatchObject({ Bucket: 'test-bucket', Key: 'reports/report-1.xlsx' });
    expect(store.markReady).toHaveBeenCalledWith('report-1', 'reports/report-1.xlsx', 2, 0);
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'WOONBEHOEFTE_EXCEL_GENERATED', outcome: 'SUCCESS', metadata: expect.objectContaining({ reportId: 'report-1', caseCount: 2 }),
    }));
  });

  it('counts a case with a Bronwaarschuwing (missing source) in warningCount, but still exports it', async () => {
    const { deps, store, sourceCacheStore } = makeDeps(makeReport());
    (sourceCacheStore.readReadySubmissions as jest.Mock).mockResolvedValue({
      submissions: [source({ caseReference: 'OF-1' })],
      failedMarkers: [],
    });

    await runWoonbehoefteExcelReport('report-1', deps, () => false, 'trace-1');

    // OF-2 has no matching source: exported with a warning, not dropped.
    expect(store.markReady).toHaveBeenCalledWith('report-1', 'reports/report-1.xlsx', 2, 1);
  });

  it('only exports cases matching the report filter', async () => {
    const report = makeReport({ filter: { ...filter, statuses: ['IN_PROGRESS'] } });
    const { deps, store, caseRepository } = makeDeps(report);
    (caseRepository.listCases as jest.Mock).mockResolvedValue([
      woonbehoefteCase({ caseReference: 'OF-1', status: 'NEW' }),
      woonbehoefteCase({ caseReference: 'OF-2', status: 'IN_PROGRESS' }),
    ]);

    await runWoonbehoefteExcelReport('report-1', deps, () => false, 'trace-1');

    expect(store.markReady).toHaveBeenCalledWith('report-1', 'reports/report-1.xlsx', 1, expect.any(Number));
  });

  it('does not start a run when the report is no longer QUEUED (duplicate async delivery)', async () => {
    const { deps, store, s3Send } = makeDeps(makeReport());
    store.claimForBuilding.mockResolvedValue(false);

    await runWoonbehoefteExcelReport('report-1', deps, () => false, 'trace-1');

    expect(store.get).not.toHaveBeenCalled();
    expect(s3Send).not.toHaveBeenCalled();
  });

  it('marks TOO_LARGE and never uploads a partial file once the time cutoff is reached', async () => {
    const { deps, store, s3Send, auditRecord } = makeDeps(makeReport());

    await runWoonbehoefteExcelReport('report-1', deps, () => true, 'trace-1');

    expect(s3Send).not.toHaveBeenCalled();
    expect(store.markTooLarge).toHaveBeenCalledWith('report-1');
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'WOONBEHOEFTE_EXCEL_GENERATION_FAILED',
      metadata: expect.objectContaining({ failureReason: 'TIME_LIMIT_REACHED' }),
    }));
  });

  it('marks FAILED with a compact reason and uploads nothing when reading Cases/source fails', async () => {
    const { deps, store, s3Send, caseRepository } = makeDeps(makeReport());
    (caseRepository.listCases as jest.Mock).mockRejectedValue(new Error('DynamoDB unavailable'));

    await runWoonbehoefteExcelReport('report-1', deps, () => false, 'trace-1');

    expect(s3Send).not.toHaveBeenCalled();
    expect(store.markFailed).toHaveBeenCalledWith('report-1', 'DATA_READ_ERROR');
  });

  it('never marks READY when the S3 upload itself fails', async () => {
    const { deps, store, s3Send } = makeDeps(makeReport());
    s3Send.mockRejectedValue(new Error('S3 unavailable'));

    await runWoonbehoefteExcelReport('report-1', deps, () => false, 'trace-1');

    expect(store.markReady).not.toHaveBeenCalled();
    expect(store.markFailed).toHaveBeenCalledWith('report-1', 'STORAGE_ERROR');
  });

  it('never calls Open Zaak when includeAllFormFields is off', async () => {
    const { deps, getDocumentText } = makeDeps(makeReport());

    await runWoonbehoefteExcelReport('report-1', deps, () => false, 'trace-1');

    expect(getDocumentText).not.toHaveBeenCalled();
  });

  it('fetches the primary CSV for every matched case when includeAllFormFields is on', async () => {
    const report = makeReport({ options: { includeAllFormFields: true, includeAttachmentFilenames: false } });
    const { deps, getDocumentText, store } = makeDeps(report);

    await runWoonbehoefteExcelReport('report-1', deps, () => false, 'trace-1');

    expect(getDocumentText).toHaveBeenCalledTimes(2);
    expect(store.markReady).toHaveBeenCalledWith('report-1', 'reports/report-1.xlsx', 2, 0);
  });

  it('turns a raw form field fetch failure into a Bronwaarschuwing warning, but still finishes READY', async () => {
    const report = makeReport({ options: { includeAllFormFields: true, includeAttachmentFilenames: false } });
    const { deps, getDocumentText, store } = makeDeps(report);
    getDocumentText.mockRejectedValueOnce(new Error('Open Zaak unavailable'));

    await runWoonbehoefteExcelReport('report-1', deps, () => false, 'trace-1');

    expect(store.markReady).toHaveBeenCalledWith('report-1', 'reports/report-1.xlsx', 2, 1);
  });

  it('checks the cutoff after the raw form field fetch phase too, marking TOO_LARGE instead of uploading', async () => {
    const report = makeReport({ options: { includeAllFormFields: true, includeAttachmentFilenames: false } });
    const { deps, s3Send, store } = makeDeps(report);
    let callCount = 0;
    const isPastCutoff = () => {
      callCount += 1;
      // false for the two earlier checks (before fetch, after cases/source read), true once the raw-field fetch is done.
      return callCount > 2;
    };

    await runWoonbehoefteExcelReport('report-1', deps, isPastCutoff, 'trace-1');

    expect(s3Send).not.toHaveBeenCalled();
    expect(store.markTooLarge).toHaveBeenCalledWith('report-1');
  });

  it('never reads source links or Open Zaak metadata when includeAttachmentFilenames is off', async () => {
    const { deps, caseRepository, getDocumentMetadata } = makeDeps(makeReport());

    await runWoonbehoefteExcelReport('report-1', deps, () => false, 'trace-1');

    expect(caseRepository.getSourceLinks).not.toHaveBeenCalled();
    expect(getDocumentMetadata).not.toHaveBeenCalled();
  });

  it('resolves primary attachment filenames for every matched case when includeAttachmentFilenames is on', async () => {
    const report = makeReport({ options: { includeAllFormFields: false, includeAttachmentFilenames: true } });
    const { deps, caseRepository, getDocumentMetadata, store } = makeDeps(report);
    (caseRepository.getSourceLinks as jest.Mock).mockResolvedValue([]);
    (deps.sourceCacheStore.readReadySubmissions as jest.Mock).mockResolvedValue({
      submissions: [
        source({
          caseReference: 'OF-1',
          registrationAt: '2026-08-20T10:15:00.000Z',
          attachments: [{ documentId: 'doc-attach-1', url: 'https://open-zaak.example.invalid/attach-1', role: 'ATTACHMENT' }],
        }),
        source({ caseReference: 'OF-2', registrationAt: '2026-08-21T10:15:00.000Z' }),
      ],
      failedMarkers: [],
    });

    await runWoonbehoefteExcelReport('report-1', deps, () => false, 'trace-1');

    expect(getDocumentMetadata).toHaveBeenCalledTimes(1);
    expect(getDocumentMetadata).toHaveBeenCalledWith('https://open-zaak.example.invalid/attach-1', expect.anything());
    expect(store.markReady).toHaveBeenCalledWith('report-1', 'reports/report-1.xlsx', 2, 0);
  });

  it('includes a linked Additional Evidence source attachments, resolved through the shared source-cache table', async () => {
    const report = makeReport({ options: { includeAllFormFields: false, includeAttachmentFilenames: true } });
    const { deps, caseRepository, additionalSourceCacheStore, getDocumentMetadata } = makeDeps(report);
    (caseRepository.getSourceLinks as jest.Mock).mockImplementation(async (caseReference: string) => (
      caseReference === 'OF-1' ? [additionalLink(caseReference, 'additional-uuid-1')] : []
    ));
    (additionalSourceCacheStore.getItems as jest.Mock).mockResolvedValue(new Map([
      ['additional-uuid-1', {
        status: 'READY',
        cacheVersion: 1,
        objectUuid: 'additional-uuid-1',
        submissionId: 'additional-uuid-1',
        reference: 'EB-1',
        formName: 'Extra bewijzen',
        submittedAt: '2026-08-22T00:00:00.000Z',
        originalCaseReference: 'OF-1',
        attachments: [{ documentId: 'doc-additional-1', url: 'https://open-zaak.example.invalid/additional-1', role: 'ATTACHMENT' }],
        cachedAt: '2026-08-22T00:00:00.000Z',
      }],
    ]));

    await runWoonbehoefteExcelReport('report-1', deps, () => false, 'trace-1');

    expect(additionalSourceCacheStore.getItems).toHaveBeenCalledWith(['additional-uuid-1']);
    expect(getDocumentMetadata).toHaveBeenCalledWith('https://open-zaak.example.invalid/additional-1', expect.anything());
  });

  it('turns a missing linked Additional Evidence source into a Bronwaarschuwing warning, not a report failure', async () => {
    const report = makeReport({ options: { includeAllFormFields: false, includeAttachmentFilenames: true } });
    const { deps, caseRepository, additionalSourceCacheStore, store } = makeDeps(report);
    (caseRepository.getSourceLinks as jest.Mock).mockImplementation(async (caseReference: string) => (
      caseReference === 'OF-1' ? [additionalLink(caseReference, 'missing-uuid')] : []
    ));
    (additionalSourceCacheStore.getItems as jest.Mock).mockResolvedValue(new Map());

    await runWoonbehoefteExcelReport('report-1', deps, () => false, 'trace-1');

    expect(store.markReady).toHaveBeenCalledWith('report-1', 'reports/report-1.xlsx', 2, 1);
  });

  it('turns an attachment metadata fetch failure into a Bronwaarschuwing warning, but still finishes READY', async () => {
    const report = makeReport({ options: { includeAllFormFields: false, includeAttachmentFilenames: true } });
    const { deps, caseRepository, getDocumentMetadata, store } = makeDeps(report);
    (caseRepository.getSourceLinks as jest.Mock).mockResolvedValue([]);
    (deps.sourceCacheStore.readReadySubmissions as jest.Mock).mockResolvedValue({
      submissions: [
        source({
          caseReference: 'OF-1',
          registrationAt: '2026-08-20T10:15:00.000Z',
          attachments: [{ documentId: 'doc-attach-1', url: 'https://open-zaak.example.invalid/attach-1', role: 'ATTACHMENT' }],
        }),
        source({ caseReference: 'OF-2', registrationAt: '2026-08-21T10:15:00.000Z' }),
      ],
      failedMarkers: [],
    });
    getDocumentMetadata.mockRejectedValueOnce(new Error('Open Zaak unavailable'));

    await runWoonbehoefteExcelReport('report-1', deps, () => false, 'trace-1');

    expect(store.markReady).toHaveBeenCalledWith('report-1', 'reports/report-1.xlsx', 2, 1);
  });

  it('checks the cutoff after the attachment filenames phase too, marking TOO_LARGE instead of uploading', async () => {
    const report = makeReport({ options: { includeAllFormFields: false, includeAttachmentFilenames: true } });
    const { deps, s3Send, store } = makeDeps(report);
    let callCount = 0;
    const isPastCutoff = () => {
      callCount += 1;
      // false for the two earlier checks (before fetch, after cases/source read), true once the attachment phase is done.
      return callCount > 2;
    };

    await runWoonbehoefteExcelReport('report-1', deps, isPastCutoff, 'trace-1');

    expect(s3Send).not.toHaveBeenCalled();
    expect(store.markTooLarge).toHaveBeenCalledWith('report-1');
  });
});
