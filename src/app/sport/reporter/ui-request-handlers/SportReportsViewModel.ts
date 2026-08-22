import { SPORT_DISTRICT_LABELS, SportDistrict } from '../../sportdata/SportDistrictAuthorization';
import { isReportAvailable, SportReport, SportReportStatus } from '../store/SportReport';

export interface SportReportDistrictOption {
  value: string;
  label: string;
}

export interface SportReportListItem {
  reportId: string;
  statusLabel: string;
  statusVariant: string;
  districtsLabel: string;
  from: string;
  to: string;
  requestedAtLabel: string;
  submissionCountLabel?: string;
  expiresAtLabel?: string;
  canDownload: boolean;
  canDelete: boolean;
}

export interface SportReportsViewModel {
  districtOptions: SportReportDistrictOption[];
  defaultFrom: string;
  defaultTo: string;
  hasReports: boolean;
  reports: SportReportListItem[];
  message?: string;
}

const STATUS_LABELS: Record<SportReportStatus, string> = {
  QUEUED: 'Wordt gemaakt',
  BUILDING: 'Wordt gemaakt',
  READY: 'Gereed',
  TOO_LARGE: 'Te groot, kies een kortere periode',
  FAILED: 'Mislukt',
  DELETED: 'Verwijderd',
};

// Status stays readable as plain text regardless of variant; the color is reinforcement, not the only signal.
const STATUS_VARIANTS: Record<SportReportStatus, string> = {
  QUEUED: 'building',
  BUILDING: 'building',
  READY: 'ready',
  TOO_LARGE: 'failed',
  FAILED: 'failed',
  DELETED: 'failed',
};

export function buildSportReportsViewModel(
  reports: SportReport[],
  allowedDistricts: SportDistrict[],
  defaults: { from: string; to: string },
  message?: string,
): SportReportsViewModel {
  const allowedSet = new Set<string>(allowedDistricts);
  // Same full-coverage rule as canDownload/canDelete, but here it also gates visibility.
  const visible = reports.filter(
    (report) => isReportAvailable(report) && report.districts.every((district) => allowedSet.has(district)),
  );

  return {
    districtOptions: allowedDistricts.map((district) => ({ value: district, label: SPORT_DISTRICT_LABELS[district] })),
    defaultFrom: defaults.from,
    defaultTo: defaults.to,
    hasReports: visible.length > 0,
    reports: visible.map(toListItem),
    ...(message ? { message } : {}),
  };
}

function toListItem(report: SportReport): SportReportListItem {
  return {
    reportId: report.reportId,
    statusLabel: STATUS_LABELS[report.status],
    statusVariant: STATUS_VARIANTS[report.status],
    districtsLabel: report.districts.map((district) => SPORT_DISTRICT_LABELS[district]).join(', '),
    from: formatDutchDate(report.from),
    to: formatDutchDate(report.to),
    requestedAtLabel: formatDutchDateTime(report.requestedAt),
    ...(report.submissionCount !== undefined ? { submissionCountLabel: String(report.submissionCount) } : {}),
    ...(report.status === 'READY' ? { expiresAtLabel: formatDutchDateTime(new Date(report.expiresAt * 1000).toISOString()) } : {}),
    canDownload: report.status === 'READY',
    canDelete: true,
  };
}

function formatDutchDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}-${month}-${year}`;
}

function formatDutchDateTime(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  return `${day}-${month}-${date.getUTCFullYear()} ${time}`;
}
