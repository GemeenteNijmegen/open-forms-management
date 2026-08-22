import { SportFilter } from './SportFilter';
import { FailedSportDocument } from '../sportdata/fetchSportCsvDocuments';
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

export interface SportViewModel {
  hasAccessToAllDistricts: boolean;
  allowedDistrictLabels: string[];
  districtOptions: SportFilterOption[];
  typeOptions: SportFilterOption[];
  hasSubmissions: boolean;
  submissions: SportSubmissionRow[];
  hasPartialError: boolean;
  failedCount: number;
  hasFailedDocumentLabels: boolean;
  failedDocumentLabels: string[];
}

export function buildSportViewModel(
  allowedDistricts: SportDistrict[],
  filter: SportFilter,
  submissions: SportSubmission[],
  failedCount: number,
  failedDocuments: FailedSportDocument[] = [],
): SportViewModel {
  const failedDocumentLabels = failedDocuments.map(formatFailedDocumentLabel).filter((label): label is string => label !== undefined);

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
    hasSubmissions: submissions.length > 0,
    submissions: submissions.map(toSportSubmissionRow),
    hasPartialError: failedCount > 0,
    failedCount,
    hasFailedDocumentLabels: failedDocumentLabels.length > 0,
    failedDocumentLabels,
  };
}

// Kenmerk (OF-nummer) staat er alleen bij als het object nog genoeg te herkennen was; het objectnummer
// is er vrijwel altijd, ook als de rest van het object onbruikbaar was. Zonder allebei is er niets
// zinnigs te tonen, zo'n entry laten we dan ook gewoon weg in plaats van een lege regel te tonen.
function formatFailedDocumentLabel(failedDocument: FailedSportDocument): string | undefined {
  if (failedDocument.reference && failedDocument.objectUuid) {
    return `${failedDocument.reference} (document ${failedDocument.objectUuid})`;
  }
  if (failedDocument.reference) {
    return failedDocument.reference;
  }
  if (failedDocument.objectUuid) {
    return `document ${failedDocument.objectUuid}`;
  }
  return undefined;
}

function toSportSubmissionRow(submission: SportSubmission): SportSubmissionRow {
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

function formatDutchDate(isoDate: string): string {
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
