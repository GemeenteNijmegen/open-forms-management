import { SPORT_DISTRICTS, SportDistrict } from '../../SportDistrictAuthorization';

export const SPORT_REPORT_STATUSES = ['QUEUED', 'BUILDING', 'READY', 'TOO_LARGE', 'FAILED', 'DELETED'] as const;
export type SportReportStatus = typeof SPORT_REPORT_STATUSES[number];

// A report is still BUILDING or just QUEUED; these are the only statuses a worker may claim or overwrite.
export const SPORT_REPORT_ACTIVE_STATUSES: SportReportStatus[] = ['QUEUED', 'BUILDING'];

export interface SportReport {
  reportId: string;
  districts: SportDistrict[];
  from: string;
  to: string;
  status: SportReportStatus;
  requestedBy: string;
  requestedAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  submissionCount?: number;
  storageKey?: string;
  failureReason?: string;
  expiresAt: number;
}

/** Sorts and dedupes against the fixed SPORT_DISTRICTS order, so two requests for the same districts always compare equal. */
export function canonicalDistricts(districts: SportDistrict[]): SportDistrict[] {
  return SPORT_DISTRICTS.filter((district) => districts.includes(district));
}

/** A report that's DELETED or past its TTL is kept around for idempotency/diagnosis, but never shown as usable. */
export function isReportAvailable(report: SportReport, now: Date = new Date()): boolean {
  return report.status !== 'DELETED' && report.expiresAt > Math.floor(now.getTime() / 1000);
}
