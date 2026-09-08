import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { formatFileSize } from '../../domain/WoonbehoefteFormatting';
import { SourceDocumentReference } from '../../domain/WoonbehoefteSource';

/** The only two fields a document listing needs; satisfied by both a READY source and a FAILED one that still carries document refs. */
export interface AdditionalEvidenceDocumentSource {
  pdfDocument?: SourceDocumentReference;
  attachments: SourceDocumentReference[];
}

export interface AdditionalEvidenceDocumentRow {
  documentId: string;
  filenameLabel: string;
  formatLabel?: string;
  sizeLabel?: string;
  downloadHref: string;
  isApplicationPdf: boolean;
}

function fallbackFilename(document: SourceDocumentReference, attachmentIndex: number): string {
  return document.role === 'APPLICATION_PDF' ? 'Extra-bewijzenformulier (PDF)' : `Bijlage ${attachmentIndex}`;
}

/**
 * Live per detail, not during sync: same reasoning as the primary Woonbehoefte document loader. A
 * document whose metadata call fails still gets a safe fallback name, never a broken detail page.
 */
export async function loadAdditionalEvidenceDocuments(
  client: OpenZaakClient, source: AdditionalEvidenceDocumentSource, submissionId: string, actor: EmployeeIdentity,
): Promise<AdditionalEvidenceDocumentRow[]> {
  const documents: SourceDocumentReference[] = [
    ...(source.pdfDocument ? [source.pdfDocument] : []),
    ...source.attachments,
  ];
  const results = await Promise.allSettled(documents.map((document) => client.getDocumentMetadata(document.url, actor)));

  let attachmentIndex = 0;
  return documents.map((document, index) => {
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
      downloadHref: `/woonbehoefte/additional-evidence/${encodeURIComponent(submissionId)}/documents/${document.documentId}`,
      isApplicationPdf: document.role === 'APPLICATION_PDF',
    };
  });
}
