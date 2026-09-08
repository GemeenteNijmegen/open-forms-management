import { SourceDocumentReference } from '../../domain/WoonbehoefteSource';

/**
 * Bumped when the cached shape/meaning changes; the sync worker treats an item on an older
 * version as a miss and rebuilds it from Objects/Open Zaak, so there is no migration step.
 */
export const ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION = 1;

export interface AdditionalEvidenceSourceRecord {
  status: 'READY';
  cacheVersion: number;

  objectUuid: string;
  submissionId: string;

  reference: string;
  formName: string;

  submittedAt: string;
  originalCaseReference: string;

  submittedProjectName?: string;
  contactEmail?: string;
  contactPhone?: string;
  evidenceDescription?: string;
  remarks?: string;

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
export interface AdditionalEvidenceSourceFailure {
  status: 'FAILED';
  objectUuid: string;
  reference?: string;
  failureReasonCode: string;
  lastAttemptAt: string;
  pdfDocument?: SourceDocumentReference;
  attachments?: SourceDocumentReference[];
}

export type AdditionalEvidenceSourceItem = AdditionalEvidenceSourceRecord | AdditionalEvidenceSourceFailure;

export function isReadyAdditionalEvidenceSource(item: AdditionalEvidenceSourceItem): item is AdditionalEvidenceSourceRecord {
  return item.status === 'READY';
}

export function isFailedAdditionalEvidenceSource(item: AdditionalEvidenceSourceItem): item is AdditionalEvidenceSourceFailure {
  return item.status === 'FAILED';
}
