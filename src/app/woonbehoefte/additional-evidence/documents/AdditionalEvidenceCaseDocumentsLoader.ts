import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { CaseSourceLink } from '../../domain/WoonbehoefteCase';
import { formatDutchDateTime, formatFileSize } from '../../domain/WoonbehoefteFormatting';
import { SourceDocumentReference } from '../../domain/WoonbehoefteSource';
import { AdditionalEvidenceSourceItem, isReadyAdditionalEvidenceSource } from '../domain/AdditionalEvidenceSource';

export interface AdditionalEvidenceCaseDocumentRow {
  documentId: string;
  filenameLabel: string;
  formatLabel?: string;
  sizeLabel?: string;
  downloadHref: string;
}

export interface AdditionalEvidenceCaseDocumentGroup {
  submissionReference: string;
  submittedAtLabel: string;
  linkedAtLabel: string;
  linkedByLabel: string;
  hasSourceError: boolean;
  sourceErrorMessage?: string;
  documents: AdditionalEvidenceCaseDocumentRow[];
  hasDocuments: boolean;
}

function fallbackFilename(document: SourceDocumentReference, attachmentIndex: number): string {
  return document.role === 'APPLICATION_PDF' ? 'Extra-bewijzenformulier (PDF)' : `Bijlage ${attachmentIndex}`;
}

function sourceErrorMessage(sourceItem: AdditionalEvidenceSourceItem | undefined): string {
  return sourceItem
    ? 'De brongegevens van deze extra-bewijzeninzending konden niet volledig worden gelezen. Ververs Extra bewijzen later opnieuw.'
    : 'De brongegevens van deze extra-bewijzeninzending zijn nog niet beschikbaar. Probeer een verversing.';
}

/** Same live-per-detail reasoning as the other document loaders: metadata is fetched here, never during sync. */
async function loadGroupDocuments(
  client: OpenZaakClient, caseReference: string, sourceItem: AdditionalEvidenceSourceItem | undefined, actor: EmployeeIdentity,
): Promise<AdditionalEvidenceCaseDocumentRow[]> {
  // A FAILED source can still carry pdfDocument/attachments if the Object envelope itself was valid; a MISSING one has none.
  const documentRefs: SourceDocumentReference[] = sourceItem
    ? [...(sourceItem.pdfDocument ? [sourceItem.pdfDocument] : []), ...(sourceItem.attachments ?? [])]
    : [];
  const results = await Promise.allSettled(documentRefs.map((document) => client.getDocumentMetadata(document.url, actor)));

  let attachmentIndex = 0;
  return documentRefs.map((document, index) => {
    if (document.role === 'ATTACHMENT') {
      attachmentIndex += 1;
    }
    const result = results[index];
    const metadata = result.status === 'fulfilled' ? result.value : undefined;
    return {
      documentId: document.documentId,
      filenameLabel: metadata?.bestandsnaam ?? fallbackFilename(document, attachmentIndex),
      ...(metadata?.formaat ? { formatLabel: metadata.formaat } : {}),
      ...(metadata?.bestandsomvang ? { sizeLabel: formatFileSize(metadata.bestandsomvang) } : {}),
      // The case's own document route: the source is already linked to this case, no separate additional-evidence route needed.
      downloadHref: `/woonbehoefte/cases/${encodeURIComponent(caseReference)}/documents/${document.documentId}`,
    };
  });
}

/**
 * Builds one documentgroep per gekoppelde extra-bewijzeninzending, shown alongside the primary aanvraag on
 * the hoofdzaak-detailpagina. Isolated here on purpose: `WoonbehoefteDetailHandler`/`WoonbehoefteDetailViewModel`
 * only pass the result straight through, so a primary-detail regression review never has to reason about
 * extra-bewijzen-specific shaping.
 */
export async function loadAdditionalEvidenceCaseDocumentGroups(
  client: OpenZaakClient, caseReference: string, additionalLinks: CaseSourceLink[], additionalSourceItems: Map<string, AdditionalEvidenceSourceItem>,
  actor: EmployeeIdentity,
): Promise<AdditionalEvidenceCaseDocumentGroup[]> {
  return Promise.all(additionalLinks.map(async (link) => {
    const sourceItem = additionalSourceItems.get(link.submissionId);
    const readySource = sourceItem && isReadyAdditionalEvidenceSource(sourceItem) ? sourceItem : undefined;
    const documents = await loadGroupDocuments(client, caseReference, sourceItem, actor);
    return {
      submissionReference: link.submissionReference,
      submittedAtLabel: readySource ? formatDutchDateTime(readySource.submittedAt) : '-',
      linkedAtLabel: formatDutchDateTime(link.linkedAt),
      linkedByLabel: link.linkedBy ?? '-',
      hasSourceError: !readySource,
      ...(!readySource ? { sourceErrorMessage: sourceErrorMessage(sourceItem) } : {}),
      documents,
      hasDocuments: documents.length > 0,
    };
  }));
}
