import { APPLICANT_TYPE_LABELS, CASE_STATUS_LABELS } from '../../domain/CaseLabels';
import { CASE_STATUSES } from '../../domain/CaseStatus';
import { formatDutchDateTime } from '../../domain/WoonbehoefteFormatting';
import { APPLICANT_TYPES } from '../../domain/WoonbehoefteSource';
import { isReportAvailable, WoonbehoefteReport, WoonbehoefteReportStatus } from '../domain/WoonbehoefteReport';

export interface WoonbehoefteReportListItem {
  reportId: string;
  statusLabel: string;
  statusVariant: string;
  requestedByLabel: string;
  requestedAtLabel: string;
  caseCountLabel?: string;
  warningCountLabel?: string;
  includeAllFormFieldsLabel: string;
  includeAttachmentFilenamesLabel: string;
  expiresAtLabel?: string;
  canDownload: boolean;
  canDelete: boolean;
}

export interface WoonbehoefteReportsListViewModel {
  hasReports: boolean;
  reports: WoonbehoefteReportListItem[];
}

const STATUS_LABELS: Record<WoonbehoefteReportStatus, string> = {
  QUEUED: 'Wordt gemaakt',
  BUILDING: 'Wordt gemaakt',
  READY: 'Gereed',
  TOO_LARGE: 'Te groot, kies een kleinere selectie',
  FAILED: 'Mislukt',
  DELETED: 'Verwijderd',
};

// Own report-status badge variants, not the case-status ones: same feedback color tokens, but a report
// being "ready" has nothing to do with a case being "ready for ranking". The label text stays the real signal.
const STATUS_VARIANTS: Record<WoonbehoefteReportStatus, string> = {
  QUEUED: 'report-building',
  BUILDING: 'report-building',
  READY: 'report-ready',
  TOO_LARGE: 'report-failed',
  FAILED: 'report-failed',
  DELETED: 'report-failed',
};

export function buildWoonbehoefteReportsListViewModel(reports: WoonbehoefteReport[]): WoonbehoefteReportsListViewModel {
  const visible = reports.filter((report) => isReportAvailable(report));
  return {
    hasReports: visible.length > 0,
    reports: visible.map(toListItem),
  };
}

export interface WoonbehoefteReportFilterOption {
  value: string;
  label: string;
}

export interface WoonbehoefteReportRequestFormViewModel {
  statusOptions: WoonbehoefteReportFilterOption[];
  applicantTypeOptions: WoonbehoefteReportFilterOption[];
}

/**
 * Static option lists (status/applicantType), unlike the regular overview's own filter form: this page
 * has no Cases/source read access (see WoonbehoefteReportsFeature IAM), so it cannot compute a dynamic
 * "available start years in the current data" list the way the overview does. Start year is a free-text
 * field on the request form instead of a checkbox-per-year list for that reason.
 */
export function buildWoonbehoefteReportRequestFormViewModel(): WoonbehoefteReportRequestFormViewModel {
  return {
    statusOptions: CASE_STATUSES.map((status) => ({ value: status, label: CASE_STATUS_LABELS[status] })),
    applicantTypeOptions: APPLICANT_TYPES.map((type) => ({ value: type, label: APPLICANT_TYPE_LABELS[type] })),
  };
}

function toListItem(report: WoonbehoefteReport): WoonbehoefteReportListItem {
  return {
    reportId: report.reportId,
    statusLabel: STATUS_LABELS[report.status],
    statusVariant: STATUS_VARIANTS[report.status],
    requestedByLabel: report.requestedBy,
    requestedAtLabel: formatDutchDateTime(report.requestedAt),
    ...(report.caseCount !== undefined ? { caseCountLabel: String(report.caseCount) } : {}),
    ...(report.warningCount ? { warningCountLabel: String(report.warningCount) } : {}),
    includeAllFormFieldsLabel: report.options.includeAllFormFields ? 'Ja' : 'Nee',
    includeAttachmentFilenamesLabel: report.options.includeAttachmentFilenames ? 'Ja' : 'Nee',
    ...(report.status === 'READY' ? { expiresAtLabel: formatDutchDateTime(new Date(report.expiresAt * 1000).toISOString()) } : {}),
    canDownload: report.status === 'READY',
    canDelete: true,
  };
}
