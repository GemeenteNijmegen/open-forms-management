export type WoonbehoefteSubmissionType = 'PRIMARY_APPLICATION' | 'ADDITIONAL_DOCUMENTS';

/**
 * The aanvrager's primary type. `UNKNOWN` covers missing/ambiguous source booleans; it must never be
 * silently derived as `PROJECT_APPLICANT` just because the individual/gemeente flags are absent.
 */
export const APPLICANT_TYPES = ['INDIVIDUAL', 'MUNICIPALITY_NIJMEGEN', 'PROJECT_APPLICANT', 'UNKNOWN'] as const;

export type ApplicantType = typeof APPLICANT_TYPES[number];

export function isApplicantType(value: unknown): value is ApplicantType {
  return typeof value === 'string' && (APPLICANT_TYPES as readonly string[]).includes(value);
}

export type SourceDocumentRole = 'CSV' | 'APPLICATION_PDF' | 'ATTACHMENT';

export interface SourceDocumentReference {
  documentId: string;
  url: string;
  role: SourceDocumentRole;
}

/**
 * Bumped when the cached shape/meaning changes; the sync worker treats an item on an older
 * version as a miss and rebuilds it from Objects/Open Zaak, so there is no migration step.
 */
export const WOONBEHOEFTE_SOURCE_CACHE_VERSION = 1;

export interface WoonbehoefteSourceRecord {
  status: 'READY';
  cacheVersion: number;

  objectUuid: string;
  submissionId: string;
  submissionType: WoonbehoefteSubmissionType;

  reference: string;
  caseReference: string;
  formName: string;
  registrationAt: string;

  projectName?: string;
  projectDescription?: string;

  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;

  hasExistingLianderRequest?: boolean;
  eanOrApplicationNumber?: string;

  totalHomes?: number;

  submittedStartDate?: string;
  startDateExplanation?: string;
  submittedCompletionDate?: string;
  submittedProjectReadiness?: 1 | 2 | 3 | 4 | 5 | 6;

  applicantType: ApplicantType;
  isCollectiveHousing?: boolean;
  collectiveHousingCategory?: string;

  hasCollectiveFacilities?: boolean;
  hasKova?: boolean;

  csvDocument?: SourceDocumentReference;
  pdfDocument?: SourceDocumentReference;
  attachments: SourceDocumentReference[];

  cachedAt: string;
}

/**
 * No name/email/phone/CSV content ever ends up in a failure marker, only what's needed to
 * retry, to show a technical warning, and (if the Object envelope was itself valid) to keep the
 * medewerker-facing PDF/attachments downloadable despite the CSV failure.
 */
export interface WoonbehoefteSourceFailure {
  status: 'FAILED';
  objectUuid: string;
  reference?: string;
  submissionType?: WoonbehoefteSubmissionType;
  failureReasonCode: string;
  lastAttemptAt: string;
  pdfDocument?: SourceDocumentReference;
  attachments?: SourceDocumentReference[];
}

export type WoonbehoefteSourceItem = WoonbehoefteSourceRecord | WoonbehoefteSourceFailure;

export function isReadySource(item: WoonbehoefteSourceItem): item is WoonbehoefteSourceRecord {
  return item.status === 'READY';
}

export function isFailedSource(item: WoonbehoefteSourceItem): item is WoonbehoefteSourceFailure {
  return item.status === 'FAILED';
}
