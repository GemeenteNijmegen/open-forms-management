import * as fs from 'fs';
import * as path from 'path';
import { S3Client } from '@aws-sdk/client-s3';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { ObjectsClient } from '../../../../shared/clients/objects/ObjectsClient';
import { ObjectResource } from '../../../../shared/clients/objects/ObjectsResponse';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { runSportExcelReport, SportExcelWorkerDependencies } from '../SportExcelWorkerRunner';
import { SportReport } from '../store/SportReport';
import { SportReportStore } from '../store/SportReportStore';

const samplesDir = path.join(__dirname, '../../sportdata/test/samples');

function fixture(name: string): string {
  return fs.readFileSync(path.join(samplesDir, name), 'utf-8');
}

function objectResource(uuid: string, reference: string, csvUrl: string): ObjectResource {
  return { uuid, record: { data: { reference, csv: csvUrl }, registrationAt: '2026-01-15' } } as ObjectResource;
}

function makeReport(overrides: Partial<SportReport> = {}): SportReport {
  return {
    reportId: 'report-1',
    districts: ['dukenburg', 'lindenholt'],
    from: '2026-01-01',
    to: '2026-01-31',
    status: 'QUEUED',
    requestedBy: 'medewerker@nijmegen.nl',
    requestedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

function makeDeps(report: SportReport) {
  const csvByUrl: Record<string, string> = {
    'csv://dukenburg': fixture('sport-submission-child-dukenburg.csv'),
    'csv://lindenholt': fixture('sport-submission-child-lindenholt.csv'),
  };

  const objectsClient = {
    collectObjects: jest.fn().mockResolvedValue([
      objectResource('uuid-1', 'urn:test:dukenburg', 'csv://dukenburg'),
      objectResource('uuid-2', 'urn:test:lindenholt', 'csv://lindenholt'),
    ]),
  } as unknown as ObjectsClient;

  const getDocumentText = jest.fn().mockImplementation(async (url: string) => csvByUrl[url]);
  const openZaakClient = { getDocumentText } as unknown as OpenZaakClient;

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

  const deps: SportExcelWorkerDependencies = {
    objectsClient, openZaakClient, s3Client, auditTrail, bucketName: 'test-bucket', reportStore: store as unknown as SportReportStore,
  };

  return { deps, store, s3Send, auditRecord, getDocumentText };
}

describe('runSportExcelReport', () => {
  it('claims the report, collects both districts, uploads the Excel file, and marks it READY', async () => {
    const report = makeReport();
    const { deps, store, s3Send, auditRecord } = makeDeps(report);

    await runSportExcelReport('report-1', deps, () => false, 'trace-1');

    expect(store.claimForBuilding).toHaveBeenCalledWith('report-1');
    expect(s3Send).toHaveBeenCalledTimes(1);
    expect(s3Send.mock.calls[0][0].input).toMatchObject({ Bucket: 'test-bucket', Key: 'reports/report-1.xlsx' });
    expect(store.markReady).toHaveBeenCalledWith('report-1', 'reports/report-1.xlsx', 2);
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'SPORT_EXCEL_GENERATED', outcome: 'SUCCESS' }));
  });

  it('does not start a run when the report is no longer QUEUED (duplicate async delivery)', async () => {
    const { deps, store, s3Send } = makeDeps(makeReport());
    store.claimForBuilding.mockResolvedValue(false);

    await runSportExcelReport('report-1', deps, () => false, 'trace-1');

    expect(store.get).not.toHaveBeenCalled();
    expect(s3Send).not.toHaveBeenCalled();
  });

  it('marks TOO_LARGE and never uploads a partial file once the time cutoff is reached', async () => {
    const { deps, store, s3Send, auditRecord } = makeDeps(makeReport());

    await runSportExcelReport('report-1', deps, () => true, 'trace-1');

    expect(s3Send).not.toHaveBeenCalled();
    expect(store.markTooLarge).toHaveBeenCalledWith('report-1');
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'SPORT_EXCEL_GENERATION_FAILED',
      metadata: expect.objectContaining({ failureReason: 'TIME_LIMIT_REACHED' }),
    }));
  });

  it('marks FAILED with a compact reason and uploads nothing on a representative document failure', async () => {
    const { deps, store, s3Send, getDocumentText } = makeDeps(makeReport());
    getDocumentText.mockRejectedValue(new Error('Open Zaak unavailable'));

    await runSportExcelReport('report-1', deps, () => false, 'trace-1');

    expect(s3Send).not.toHaveBeenCalled();
    expect(store.markFailed).toHaveBeenCalledWith('report-1', 'DOCUMENT_ERROR');
  });

  it('never marks READY when the S3 upload itself fails', async () => {
    const { deps, store, s3Send } = makeDeps(makeReport());
    s3Send.mockRejectedValue(new Error('S3 unavailable'));

    await runSportExcelReport('report-1', deps, () => false, 'trace-1');

    expect(store.markReady).not.toHaveBeenCalled();
    expect(store.markFailed).toHaveBeenCalledWith('report-1', 'STORAGE_ERROR');
  });
});
