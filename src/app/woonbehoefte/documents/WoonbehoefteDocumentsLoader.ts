import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { OpenZaakClient } from '../../../shared/clients/open-zaak/OpenZaakClient';
import { formatFileSize } from '../domain/WoonbehoefteFormatting';
import { SourceDocumentReference } from '../domain/WoonbehoefteSource';

/** The only two fields a document listing needs; satisfied by both a READY source and a FAILED one that still carries document refs. */
export interface WoonbehoefteDocumentSource {
  pdfDocument?: SourceDocumentReference;
  attachments: SourceDocumentReference[];
}

export interface WoonbehoefteDocumentRow {
  documentId: string;
  filenameLabel: string;
  formatLabel?: string;
  sizeLabel?: string;
  originLabel: string;
  downloadHref: string;
  isApplicationPdf: boolean;
}

function fallbackFilename(document: SourceDocumentReference, attachmentIndex: number): string {
  return document.role === 'APPLICATION_PDF' ? 'Aanvraagformulier (PDF)' : `Bijlage ${attachmentIndex}`;
}

/**
 * Live per detail, not during sync: an application with dozens of attachments would otherwise mean
 * thousands of extra Open Zaak metadata calls during a bulk refresh. A document whose metadata call
 * fails still gets a safe fallback name, never a broken detail page.
 */
export async function loadWoonbehoefteDocuments(
  client: OpenZaakClient, source: WoonbehoefteDocumentSource, caseReference: string, actor: EmployeeIdentity,
): Promise<WoonbehoefteDocumentRow[]> {
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
      originLabel: 'Oorspronkelijke aanvraag',
      downloadHref: `/woonbehoefte/cases/${encodeURIComponent(caseReference)}/documents/${document.documentId}`,
      isApplicationPdf: document.role === 'APPLICATION_PDF',
    };
  });
}
