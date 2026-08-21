import { SPORT_DISTRICT_LABELS, SportDistrict } from './SportDistrictAuthorization';
import { SportSubmission, SportSubmissionChild } from './SportSubmission';

export interface SportSubmissionRow {
  reference: string;
  districtLabel: string;
  submittedAtLines: string[];
  aanmeldTypeLabel: string;
  nameLines: string[];
  phone: string;
  email: string;
  activitiesLabel: string;
  remark?: string;
}

export interface SportViewModel {
  allowedDistrictsLabel: string;
  hasSubmissions: boolean;
  submissions: SportSubmissionRow[];
  hasPartialError: boolean;
  failedCount: number;
}

export function buildSportViewModel(allowedDistricts: SportDistrict[], submissions: SportSubmission[], failedCount: number): SportViewModel {
  return {
    allowedDistrictsLabel: allowedDistricts.map((district) => SPORT_DISTRICT_LABELS[district]).join(', '),
    hasSubmissions: submissions.length > 0,
    submissions: submissions.map(toSportSubmissionRow),
    hasPartialError: failedCount > 0,
    failedCount,
  };
}

function toSportSubmissionRow(submission: SportSubmission): SportSubmissionRow {
  return {
    reference: submission.reference,
    districtLabel: SPORT_DISTRICT_LABELS[submission.district as SportDistrict] ?? submission.district,
    submittedAtLines: formatSubmittedAt(submission.submittedAt),
    aanmeldTypeLabel: submission.aanmeldType === 'kind' ? 'Kind' : 'Volwassene',
    nameLines: [submission.contactName, ...buildChildLines(submission.child)],
    phone: submission.phone,
    email: submission.email,
    activitiesLabel: submission.activities.join(', '),
    ...(submission.remark ? { remark: submission.remark } : {}),
  };
}

/** Prefixed with "Kind:" so the child's name doesn't read as a second contactpersoon under nameLines. */
function buildChildLines(child?: SportSubmissionChild): string[] {
  if (!child) {
    return [];
  }
  const lines = [`Kind: ${child.name}`];
  if (child.birthDate) {
    lines.push(`Geboren: ${child.birthDate}`);
  }
  if (child.school) {
    lines.push(`School: ${child.school}`);
  }
  return lines;
}

/**
 * Date and time as two separate lines, not one string: the date has no space for the browser to wrap
 * on, so a narrow column would otherwise break it at an arbitrary character instead. `submittedAt` is
 * normalized to UTC, so both are formatted with UTC getters instead of the runtime's local timezone.
 */
function formatSubmittedAt(date: Date): string[] {
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${pad(date.getUTCDate())}-${pad(date.getUTCMonth() + 1)}-${date.getUTCFullYear()}`;
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return [day, time];
}
