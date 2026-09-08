import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { collectWoonbehoefteAttachmentReferences } from './attachments/collectWoonbehoefteAttachmentReferences';
import { fetchWoonbehoefteAttachmentFilenames } from './attachments/fetchWoonbehoefteAttachmentFilenames';
import { AttachmentFilenamesOutcome, buildAttachmentFilenamesOutcome } from './attachments/WoonbehoefteReportAttachments';
import { WoonbehoefteReport } from './domain/WoonbehoefteReport';
import { writeWoonbehoefteReportExcel } from './excel/WoonbehoefteExcelWriter';
import { matchesReportFilter } from './filters/WoonbehoefteReportFilter';
import { fetchWoonbehoefteRawFormFields, RawFormFieldsOutcome } from './rawformfields/fetchWoonbehoefteRawFormFields';
import { buildWoonbehoefteReportRows } from './reportbuilder/buildWoonbehoefteReportRows';
import { WoonbehoefteReportStore } from './store/WoonbehoefteReportStore';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { AuditTrail } from '../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { OpenZaakClient } from '../../../shared/clients/open-zaak/OpenZaakClient';
import { AdditionalEvidenceSourceCacheStore } from '../additional-evidence/source/AdditionalEvidenceSourceCacheStore';
import { WoonbehoefteCaseRepository } from '../cases/WoonbehoefteCaseRepository';
import { compareByRegistrationAtDesc, joinCasesWithSources } from '../overview/WoonbehoefteOverviewViewModel';
import { WoonbehoefteSourceCacheStore } from '../source/WoonbehoefteSourceCacheStore';

export interface WoonbehoefteExcelWorkerDependencies {
  caseRepository: WoonbehoefteCaseRepository;
  sourceCacheStore: WoonbehoefteSourceCacheStore;
  additionalSourceCacheStore: AdditionalEvidenceSourceCacheStore;
  openZaakClient: OpenZaakClient;
  s3Client: S3Client;
  reportStore: WoonbehoefteReportStore;
  auditTrail: AuditTrail;
  bucketName: string;
}

// The worker calls Open Zaak on its own behalf, well after the medewerker's original request/session ended.
const WORKER_ACTOR: EmployeeIdentity = { principalId: 'woonbehoefte-excel-worker' };

type FailurePhase = 'DATA_READ_ERROR' | 'EXCEL_ERROR' | 'STORAGE_ERROR';

function storageKeyFor(reportId: string): string {
  return `reports/${reportId}.xlsx`;
}

/**
 * Drives one report from a conditional QUEUED->BUILDING claim to a final status. Reads Cases and the
 * source cache (both the primary and, when includeAttachmentFilenames is on, the Additional Evidence
 * partition), never Objects. Open Zaak is only called when includeAllFormFields or includeAttachmentFilenames
 * is on, and only for what each option needs, never for document content otherwise.
 */
export async function runWoonbehoefteExcelReport(
  reportId: string, deps: WoonbehoefteExcelWorkerDependencies, isPastCutoff: () => boolean, correlationId: string,
): Promise<void> {
  const claimed = await deps.reportStore.claimForBuilding(reportId);
  if (!claimed) {
    logger.debug('Woonbehoefte report worker skipped: report is no longer QUEUED', { reportId });
    return;
  }

  const report = await deps.reportStore.get(reportId);
  if (!report) {
    logger.warn('Woonbehoefte report worker could not reload the report it just claimed', { reportId });
    return;
  }

  let phase: FailurePhase = 'DATA_READ_ERROR';
  try {
    if (isPastCutoff()) {
      await cutoff(report, deps, correlationId);
      return;
    }

    const [cases, { submissions }] = await Promise.all([deps.caseRepository.listCases(), deps.sourceCacheStore.readReadySubmissions()]);
    const entries = joinCasesWithSources(cases, submissions)
      .filter((entry) => matchesReportFilter(entry, report.filter))
      .sort(compareByRegistrationAtDesc);
    await deps.reportStore.touchBuilding(reportId, entries.length);
    if (isPastCutoff()) {
      await cutoff(report, deps, correlationId);
      return;
    }

    let rawFormFieldsByCaseReference = new Map<string, RawFormFieldsOutcome>();
    if (report.options.includeAllFormFields) {
      rawFormFieldsByCaseReference = await fetchWoonbehoefteRawFormFields(deps.openZaakClient, entries, WORKER_ACTOR);
      if (isPastCutoff()) {
        await cutoff(report, deps, correlationId);
        return;
      }
    }

    let attachmentFilenamesByCaseReference = new Map<string, AttachmentFilenamesOutcome>();
    if (report.options.includeAttachmentFilenames) {
      const referencesByCaseReference = await collectWoonbehoefteAttachmentReferences(deps.caseRepository, deps.additionalSourceCacheStore, entries);
      const allReferences = [...referencesByCaseReference.values()].flatMap((caseReferences) => caseReferences.references);
      const filenamesByDocumentId = await fetchWoonbehoefteAttachmentFilenames(deps.openZaakClient, allReferences, WORKER_ACTOR);
      attachmentFilenamesByCaseReference = new Map(
        [...referencesByCaseReference.entries()].map(([caseReference, caseReferences]) => (
          [caseReference, buildAttachmentFilenamesOutcome(caseReferences, filenamesByDocumentId)]
        )),
      );
      if (isPastCutoff()) {
        await cutoff(report, deps, correlationId);
        return;
      }
    }

    phase = 'EXCEL_ERROR';
    const rows = buildWoonbehoefteReportRows(entries, rawFormFieldsByCaseReference, attachmentFilenamesByCaseReference);
    const warningCount = rows.filter((row) => row.sourceWarning).length;
    const excelBuffer = await writeWoonbehoefteReportExcel(rows);
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
      ContentDisposition: 'attachment; filename="woonbehoefte-overzicht.xlsx"',
    }));

    await deps.reportStore.markReady(reportId, storageKey, rows.length, warningCount);
    await recordAudit(deps.auditTrail, {
      eventType: 'WOONBEHOEFTE_EXCEL_GENERATED',
      outcome: 'SUCCESS',
      correlationId,
      resource: 'woonbehoefte',
      action: 'generate_report',
      metadata: { reportId, caseCount: rows.length, warningCount },
    });
    logger.debug('Woonbehoefte report generation finished', { reportId, rowCount: rows.length, xlsxBytes: excelBuffer.length });
  } catch (error) {
    const reason = errorReason(error);
    logger.warn('Woonbehoefte report generation failed', { reportId, phase, reason });
    await deps.reportStore.markFailed(reportId, phase);
    await recordAudit(deps.auditTrail, {
      eventType: 'WOONBEHOEFTE_EXCEL_GENERATION_FAILED',
      outcome: 'FAILURE',
      correlationId,
      resource: 'woonbehoefte',
      action: 'generate_report',
      metadata: { reportId, failureReason: phase },
    });
  }
}

async function cutoff(report: WoonbehoefteReport, deps: WoonbehoefteExcelWorkerDependencies, correlationId: string): Promise<void> {
  logger.warn('Woonbehoefte report generation reached its time cutoff', { reportId: report.reportId });
  await deps.reportStore.markTooLarge(report.reportId);
  await recordAudit(deps.auditTrail, {
    eventType: 'WOONBEHOEFTE_EXCEL_GENERATION_FAILED',
    outcome: 'FAILURE',
    correlationId,
    resource: 'woonbehoefte',
    action: 'generate_report',
    metadata: { reportId: report.reportId, failureReason: 'TIME_LIMIT_REACHED' },
  });
}
