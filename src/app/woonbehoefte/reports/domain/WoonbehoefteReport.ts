import { WoonbehoefteReportFilter } from '../filters/WoonbehoefteReportFilter';

export const WOONBEHOEFTE_REPORT_STATUSES = ['QUEUED', 'BUILDING', 'READY', 'TOO_LARGE', 'FAILED', 'DELETED'] as const;
export type WoonbehoefteReportStatus = typeof WOONBEHOEFTE_REPORT_STATUSES[number];

// A report is still BUILDING or just QUEUED; these are the only statuses a worker may claim or overwrite.
export const WOONBEHOEFTE_REPORT_ACTIVE_STATUSES: WoonbehoefteReportStatus[] = ['QUEUED', 'BUILDING'];

export interface WoonbehoefteReportOptions {
  includeAllFormFields: boolean;
  includeAttachmentFilenames: boolean;
}

export interface WoonbehoefteReport {
  reportId: string;
  filter: WoonbehoefteReportFilter;
  options: WoonbehoefteReportOptions;
  status: WoonbehoefteReportStatus;
  requestedBy: string;
  requestedAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  caseCount?: number;
  warningCount?: number;
  storageKey?: string;
  failureReason?: string;
  expiresAt: number;
}

/** A report that's DELETED or past its TTL is kept around for idempotency/diagnosis, but never shown as usable. */
export function isReportAvailable(report: WoonbehoefteReport, now: Date = new Date()): boolean {
  return report.status !== 'DELETED' && report.expiresAt > Math.floor(now.getTime() / 1000);
}
