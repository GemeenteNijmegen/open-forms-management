import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { writeSportReportExcel } from './excel/SportExcelWriter';
import { buildSportReportRows } from './reportbuilder/buildSportReportRows';
import { collectSportObjectsForReport } from './reportbuilder/collectSportObjectsForReport';
import { SportReport } from './store/SportReport';
import { SportReportStore } from './store/SportReportStore';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { AuditTrail } from '../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { ObjectsClient } from '../../../shared/clients/objects/ObjectsClient';
import { OpenZaakClient } from '../../../shared/clients/open-zaak/OpenZaakClient';
import { fetchSportCsvDocuments } from '../sportdata/fetchSportCsvDocuments';

export interface SportExcelWorkerDependencies {
  objectsClient: ObjectsClient;
  openZaakClient: OpenZaakClient;
  s3Client: S3Client;
  reportStore: SportReportStore;
  auditTrail: AuditTrail;
  bucketName: string;
}

// The worker calls Open Zaak on its own behalf, well after the medewerker's original request/session ended.
const WORKER_ACTOR: EmployeeIdentity = { principalId: 'sport-excel-worker' };

type FailurePhase = 'OBJECTS_ERROR' | 'DOCUMENT_ERROR' | 'CSV_PARSE_ERROR' | 'EXCEL_ERROR' | 'STORAGE_ERROR';

function storageKeyFor(reportId: string): string {
  return `reports/${reportId}.xlsx`;
}

/**
 * Drives one report from a conditional QUEUED->BUILDING claim to a final status. `isPastCutoff` is
 * checked between phases, not mid-phase: none of the reused Objects/CSV steps expose a per-page hook,
 * and adding one there is out of scope for this feature. Real report volumes are small enough that this
 * phase-boundary granularity keeps the worker well inside the 15-minute Lambda timeout in practice.
 */
export async function runSportExcelReport(
  reportId: string, deps: SportExcelWorkerDependencies, isPastCutoff: () => boolean, correlationId: string,
): Promise<void> {
  const claimed = await deps.reportStore.claimForBuilding(reportId);
  if (!claimed) {
    logger.debug('Sport report worker skipped: report is no longer QUEUED', { reportId });
    return;
  }

  const report = await deps.reportStore.get(reportId);
  if (!report) {
    logger.warn('Sport report worker could not reload the report it just claimed', { reportId });
    return;
  }

  let phase: FailurePhase = 'OBJECTS_ERROR';
  try {
    if (isPastCutoff()) {
      await cutoff(report, deps, correlationId);
      return;
    }

    const objects = await collectSportObjectsForReport(deps.objectsClient, report.from, report.to);
    await deps.reportStore.touchBuilding(reportId, objects.length);
    if (isPastCutoff()) {
      await cutoff(report, deps, correlationId);
      return;
    }

    phase = 'DOCUMENT_ERROR';
    const fetchResult = await fetchSportCsvDocuments(deps.openZaakClient, objects, WORKER_ACTOR);
    if (fetchResult.failedCount > 0) {
      throw new Error(`${fetchResult.failedCount} Sport CSV document(s) could not be fetched`);
    }
    if (isPastCutoff()) {
      await cutoff(report, deps, correlationId);
      return;
    }

    phase = 'CSV_PARSE_ERROR';
    const rows = buildSportReportRows(fetchResult.documents, report.districts);
    await deps.reportStore.touchBuilding(reportId, rows.length);
    if (isPastCutoff()) {
      await cutoff(report, deps, correlationId);
      return;
    }

    phase = 'EXCEL_ERROR';
    const excelBuffer = await writeSportReportExcel(rows);
    if (isPastCutoff()) {
      await cutoff(report, deps, correlationId);
      return;
    }

    phase = 'STORAGE_ERROR';
    const storageKey = storageKeyFor(reportId);
    await deps.s3Client.send(new PutObjectCommand({
      Bucket: deps.bucketName,
      Key: storageKey,
      Body: excelBuffer,
      ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ContentDisposition: 'attachment; filename="sportoverzicht.xlsx"',
    }));

    await deps.reportStore.markReady(reportId, storageKey, rows.length);
    await recordAudit(deps.auditTrail, {
      eventType: 'SPORT_EXCEL_GENERATED',
      outcome: 'SUCCESS',
      correlationId,
      resource: 'sport',
      action: 'generate_report',
      metadata: { reportId, districts: report.districts.join(','), from: report.from, to: report.to },
    });
    logger.debug('Sport report generation finished', { reportId, rowCount: rows.length, xlsxBytes: excelBuffer.length });
  } catch (error) {
    const reason = errorReason(error);
    logger.warn('Sport report generation failed', { reportId, phase, reason });
    await deps.reportStore.markFailed(reportId, phase);
    await recordAudit(deps.auditTrail, {
      eventType: 'SPORT_EXCEL_GENERATION_FAILED',
      outcome: 'FAILURE',
      correlationId,
      resource: 'sport',
      action: 'generate_report',
      metadata: { reportId, districts: report.districts.join(','), from: report.from, to: report.to, failureReason: phase },
    });
  }
}

async function cutoff(report: SportReport, deps: SportExcelWorkerDependencies, correlationId: string): Promise<void> {
  logger.warn('Sport report generation reached its time cutoff', { reportId: report.reportId });
  await deps.reportStore.markTooLarge(report.reportId);
  await recordAudit(deps.auditTrail, {
    eventType: 'SPORT_EXCEL_GENERATION_FAILED',
    outcome: 'FAILURE',
    correlationId,
    resource: 'sport',
    action: 'generate_report',
    metadata: {
      reportId: report.reportId, districts: report.districts.join(','), from: report.from, to: report.to, failureReason: 'TIME_LIMIT_REACHED',
    },
  });
}
