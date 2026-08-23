import { SportFilter } from './SportFilter';
import { SportSubmissionsPage } from './SportSubmissionsOrdering';
import { SportCacheFailureMarker } from '../cache/SportCacheItem';
import { SPORT_DISTRICT_LABELS, SPORT_DISTRICTS, SportDistrict } from '../sportdata/SportDistrictAuthorization';
import { SportAanmeldType, SportSubmission } from '../sportdata/SportSubmission';

const AANMELD_TYPE_LABELS: Record<SportAanmeldType, string> = {
  kind: 'Kind',
  volwassene: 'Volwassene',
};

const DUTCH_MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

export interface SportFilterOption {
  value: string;
  label: string;
  checked: boolean;
}

// One row is one record, not one table row: reference/districtLabel/submittedAtLines/participantName/
// typeLabel vormen de vaste scanregel (zie de sport-record__summary-grid in sport.mustache), de rest is
// de detailregel eronder.
export interface SportSubmissionRow {
  reference: string;
  districtLabel: string;
  submittedAtLines: string[];
  participantName: string;
  typeLabel: string;
  birthDateLabel?: string;
  schoolLabel?: string;
  contactRoleLabel: string;
  contactValue: string;
  activitiesLabel: string;
  remark?: string;
  pdfDownloadHref?: string;
}

/** View model for the `/sport` shell: tabs, visible-period text, allowed districts and the filter form. The
 * submissions list itself is a separate fragment (`SportSubmissionsFragmentViewModel`), fetched by the browser. */
export interface SportShellViewModel {
  hasAccessToAllDistricts: boolean;
  allowedDistrictLabels: string[];
  districtOptions: SportFilterOption[];
  typeOptions: SportFilterOption[];
  visibleFromLabel: string;
}

export function buildSportShellViewModel(allowedDistricts: SportDistrict[], filter: SportFilter, visibleFromLabel: string): SportShellViewModel {
  return {
    hasAccessToAllDistricts: allowedDistricts.length === SPORT_DISTRICTS.length,
    allowedDistrictLabels: allowedDistricts.map((district) => SPORT_DISTRICT_LABELS[district]),
    districtOptions: allowedDistricts.map((district) => ({
      value: district,
      label: SPORT_DISTRICT_LABELS[district],
      checked: filter.districts.includes(district),
    })),
    typeOptions: (['kind', 'volwassene'] as const).map((type) => ({
      value: type,
      label: AANMELD_TYPE_LABELS[type],
      checked: filter.types.includes(type),
    })),
    visibleFromLabel,
  };
}

export function toSportSubmissionRow(submission: SportSubmission): SportSubmissionRow {
  return {
    reference: submission.reference,
    districtLabel: SPORT_DISTRICT_LABELS[submission.district as SportDistrict] ?? submission.district,
    submittedAtLines: formatSubmittedAt(submission.submittedAt),
    // Bij een kind-aanmelding is het kind de sporter, niet de ouder/verzorger die het formulier invult.
    participantName: submission.child?.name ?? submission.contactName,
    typeLabel: AANMELD_TYPE_LABELS[submission.aanmeldType],
    ...(submission.child?.birthDate ? { birthDateLabel: formatDutchDate(submission.child.birthDate) } : {}),
    ...(submission.child?.school ? { schoolLabel: submission.child.school } : {}),
    contactRoleLabel: submission.aanmeldType === 'kind' ? 'Ouder/verzorger' : 'Contact',
    contactValue: buildContactValue(submission),
    activitiesLabel: submission.activities.join(', '),
    ...(submission.remark ? { remark: submission.remark } : {}),
    ...(submission.hasPdf && submission.objectUuid ? { pdfDownloadHref: `/sport/submissions/${submission.objectUuid}/pdf` } : {}),
  };
}

// Bij een kind staat de naam van de ouder/verzorger er nog bij, want die is niet de sporter zelf; bij
// een volwassene is de sporter zelf al de contactpersoon, dus die naam zou dubbelop zijn.
function buildContactValue(submission: SportSubmission): string {
  const parts = submission.aanmeldType === 'kind'
    ? [submission.contactName, submission.phone, submission.email]
    : [submission.phone, submission.email];
  return parts.join(' · ');
}

export function formatDutchDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}-${month}-${year}`;
}

// Datum en tijd als twee losse regels, niet één string: een datum heeft geen spatie om op af te breken,
// dus een smalle kolom zou hem anders op een willekeurig teken afbreken in plaats van netjes ertussenin.
// submittedAt is genormaliseerd naar UTC, dus beide met UTC-getters geformatteerd, niet de lokale tijdzone.
function formatSubmittedAt(date: Date): string[] {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = DUTCH_MONTHS[date.getUTCMonth()];
  const time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  return [`${day} ${month} ${date.getUTCFullYear()}`, time];
}

export interface SportSubmissionsFragmentViewModel {
  hasSubmissions: boolean;
  submissions: SportSubmissionRow[];
  showTotalCount: boolean;
  totalCountLabel: string;
  staleWarning: boolean;
  hasFailedDocuments: boolean;
  failedCount: number;
  failedDocumentLabels: string[];
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * `showTotalCount` is false for a "Meer tonen" page: the browser appends that HTML into the existing
 * list instead of replacing it (see sport-submissions.js), so a repeated count line would stack up.
 */
export function buildSportSubmissionsFragmentViewModel(
  page: SportSubmissionsPage, staleWarning: boolean, failedMarkers: SportCacheFailureMarker[] = [], showTotalCount: boolean = true,
): SportSubmissionsFragmentViewModel {
  const failedDocumentLabels = failedMarkers.map(formatFailedDocumentLabel);
  return {
    hasSubmissions: page.submissions.length > 0,
    submissions: page.submissions.map(toSportSubmissionRow),
    showTotalCount,
    totalCountLabel: formatTotalCountLabel(page.totalCount),
    staleWarning,
    hasFailedDocuments: failedDocumentLabels.length > 0,
    failedCount: failedDocumentLabels.length,
    failedDocumentLabels,
    hasMore: page.hasMore,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}

function formatTotalCountLabel(totalCount: number): string {
  return `${totalCount} ${totalCount === 1 ? 'inzending' : 'inzendingen'}`;
}

// Kenmerk (OF-nummer) staat er alleen bij als het object nog leesbaar genoeg was om te weten welke inzending
// het is; het objectnummer is er altijd, ook als de rest van het object onbruikbaar was.
function formatFailedDocumentLabel(marker: SportCacheFailureMarker): string {
  return marker.reference ? `${marker.reference} (document ${marker.objectUuid})` : `document ${marker.objectUuid}`;
}
