import { CASE_STATUS_LABELS } from '../../domain/CaseLabels';
import { WoonbehoefteCase } from '../../domain/WoonbehoefteCase';
import { formatDutchDateTime } from '../../domain/WoonbehoefteFormatting';
import { WoonbehoefteSourceRecord } from '../../domain/WoonbehoefteSource';
import { AdditionalEvidenceDocumentRow } from '../documents/AdditionalEvidenceDocumentsLoader';
import { ADDITIONAL_EVIDENCE_STATUS_LABELS } from '../domain/AdditionalEvidenceLabels';
import { AdditionalEvidenceSourceRecord } from '../domain/AdditionalEvidenceSource';
import { AdditionalEvidenceWorkItem, AdditionalEvidenceWorkItemStatus } from '../persistence/AdditionalEvidenceRepository';

export type AdditionalEvidenceSourceAvailability = 'READY' | 'FAILED' | 'MISSING';

export interface SelectOption {
  value: string;
  label: string;
  selected: boolean;
}

const CHANGEABLE_STATUSES: AdditionalEvidenceWorkItemStatus[] = ['NEW', 'UNKNOWN'];

/**
 * `hoofdzaak*` fields describe the target primary case, deliberately named apart from `projectNameLabel`
 * (the burger-opgegeven projectnaam of the additional evidence submission itself): the two must never be
 * visually or textually confused.
 */
export interface AdditionalEvidenceCaseLookupViewModel {
  searched: boolean;
  searchedReference: string;
  found: boolean;
  caseReference?: string;
  hoofdzaakProjectNameLabel?: string;
  hoofdzaakStatusLabel?: string;
  hoofdzaakEmail?: string;
  hoofdzaakSourceMissing: boolean;
}

export interface AdditionalEvidenceDetailViewModel {
  submissionId: string;
  submissionReference: string;
  statusLabel: string;
  statusToken: string;
  backHref: string;

  hasSourceError: boolean;
  sourceErrorMessage?: string;

  projectNameLabel: string;
  submittedAtLabel: string;
  contactEmail?: string;
  contactPhone?: string;
  evidenceDescription?: string;
  remarks?: string;

  originalCaseReferenceLabel: string;
  searchCaseReferenceValue: string;
  csrfToken?: string;
  backQuery: string;
  caseLookup: AdditionalEvidenceCaseLookupViewModel;

  canManage: boolean;
  isLinked: boolean;
  statusOptions: SelectOption[];

  applicationDocument?: AdditionalEvidenceDocumentRow;
  attachments: AdditionalEvidenceDocumentRow[];
  hasAttachments: boolean;
}

function sourceErrorMessage(availability: AdditionalEvidenceSourceAvailability): string {
  return availability === 'FAILED'
    ? 'De brongegevens van deze inzending konden niet volledig worden gelezen. Ververs Extra bewijzen later opnieuw. De inzending blijft in het overzicht staan.'
    : 'De brongegevens van deze inzending zijn nog niet beschikbaar. Probeer een verversing.';
}

/** No search performed yet on this page load: nothing to show in the "gevonden"/"niet gevonden" panel. */
export function emptyCaseLookup(): AdditionalEvidenceCaseLookupViewModel {
  return { searched: false, searchedReference: '', found: false, hoofdzaakSourceMissing: false };
}

/**
 * `targetCase`/`primarySource` are read fresh at search time, never trusted from an earlier request: a
 * search never mutates anything, and the target is validated again independently when an actual koppeling
 * happens later.
 */
export function buildAdditionalEvidenceCaseLookup(
  searchedReference: string,
  targetCase: WoonbehoefteCase | undefined,
  primarySource: WoonbehoefteSourceRecord | undefined,
  primarySourceAvailable: boolean,
): AdditionalEvidenceCaseLookupViewModel {
  if (!targetCase) {
    return { searched: true, searchedReference, found: false, hoofdzaakSourceMissing: false };
  }
  return {
    searched: true,
    searchedReference,
    found: true,
    caseReference: targetCase.caseReference,
    hoofdzaakStatusLabel: CASE_STATUS_LABELS[targetCase.status],
    hoofdzaakProjectNameLabel: primarySource?.projectName ?? 'Onbekend project (bron nog niet beschikbaar)',
    ...(primarySource?.contactEmail ? { hoofdzaakEmail: primarySource.contactEmail } : {}),
    hoofdzaakSourceMissing: !primarySourceAvailable,
  };
}

export function buildAdditionalEvidenceDetailViewModel(
  workItem: AdditionalEvidenceWorkItem,
  source: AdditionalEvidenceSourceRecord | undefined,
  sourceAvailability: AdditionalEvidenceSourceAvailability,
  documents: AdditionalEvidenceDocumentRow[],
  canManage: boolean,
  backQuery: string,
  csrfToken?: string,
  caseLookup: AdditionalEvidenceCaseLookupViewModel = emptyCaseLookup(),
): AdditionalEvidenceDetailViewModel {
  const applicationDocument = documents.find((document) => document.isApplicationPdf);
  const attachments = documents.filter((document) => !document.isApplicationPdf);

  return {
    submissionId: workItem.objectUuid,
    submissionReference: workItem.submissionReference,
    statusLabel: ADDITIONAL_EVIDENCE_STATUS_LABELS[workItem.status],
    statusToken: workItem.status.toLowerCase(),
    backHref: `/woonbehoefte/additional-evidence${backQuery ? `?${backQuery}` : ''}`,

    hasSourceError: sourceAvailability !== 'READY',
    ...(sourceAvailability !== 'READY' ? { sourceErrorMessage: sourceErrorMessage(sourceAvailability) } : {}),

    projectNameLabel: source?.submittedProjectName ?? 'Onbekend project (bron nog niet beschikbaar)',
    submittedAtLabel: source ? formatDutchDateTime(source.submittedAt) : '-',
    ...(source?.contactEmail ? { contactEmail: source.contactEmail } : {}),
    ...(source?.contactPhone ? { contactPhone: source.contactPhone } : {}),
    ...(source?.evidenceDescription ? { evidenceDescription: source.evidenceDescription } : {}),
    ...(source?.remarks ? { remarks: source.remarks } : {}),

    originalCaseReferenceLabel: source?.originalCaseReference ?? '-',
    searchCaseReferenceValue: caseLookup.searched ? caseLookup.searchedReference : (source?.originalCaseReference ?? ''),
    ...(csrfToken ? { csrfToken } : {}),
    backQuery,
    caseLookup,

    canManage,
    isLinked: workItem.status === 'LINKED',
    statusOptions: CHANGEABLE_STATUSES.map((status) => ({
      value: status, label: ADDITIONAL_EVIDENCE_STATUS_LABELS[status], selected: status === workItem.status,
    })),

    ...(applicationDocument ? { applicationDocument } : {}),
    attachments,
    hasAttachments: attachments.length > 0,
  };
}
