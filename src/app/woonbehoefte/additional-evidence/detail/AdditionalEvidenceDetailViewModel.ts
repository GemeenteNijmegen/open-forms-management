import { formatDutchDateTime } from '../../domain/WoonbehoefteFormatting';
import { AdditionalEvidenceDocumentRow } from '../documents/AdditionalEvidenceDocumentsLoader';
import { ADDITIONAL_EVIDENCE_STATUS_LABELS } from '../domain/AdditionalEvidenceLabels';
import { AdditionalEvidenceSourceRecord } from '../domain/AdditionalEvidenceSource';
import { AdditionalEvidenceWorkItem } from '../persistence/AdditionalEvidenceRepository';

export type AdditionalEvidenceSourceAvailability = 'READY' | 'FAILED' | 'MISSING';

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

  applicationDocument?: AdditionalEvidenceDocumentRow;
  attachments: AdditionalEvidenceDocumentRow[];
  hasAttachments: boolean;
}

function sourceErrorMessage(availability: AdditionalEvidenceSourceAvailability): string {
  return availability === 'FAILED'
    ? 'De brongegevens van deze inzending konden niet volledig worden gelezen. Ververs Extra bewijzen later opnieuw. De inzending blijft in het overzicht staan.'
    : 'De brongegevens van deze inzending zijn nog niet beschikbaar. Probeer een verversing.';
}

export function buildAdditionalEvidenceDetailViewModel(
  workItem: AdditionalEvidenceWorkItem,
  source: AdditionalEvidenceSourceRecord | undefined,
  sourceAvailability: AdditionalEvidenceSourceAvailability,
  documents: AdditionalEvidenceDocumentRow[],
  backQuery: string,
  csrfToken?: string,
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
    searchCaseReferenceValue: source?.originalCaseReference ?? '',
    ...(csrfToken ? { csrfToken } : {}),

    ...(applicationDocument ? { applicationDocument } : {}),
    attachments,
    hasAttachments: attachments.length > 0,
  };
}
