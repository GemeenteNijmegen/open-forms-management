import { z } from 'zod';
import { SourceDocumentReference } from '../domain/WoonbehoefteSource';

// `bsn`, `kvk`, `networkShare` and `internalNotificationEmails` also exist on the Object but are not
// functional source fields for this feature, so they are left out on purpose.
export const woonbehoefteObjectDataSchema = z.looseObject({
  formName: z.string(),
  reference: z.string(),
  csv: z.string(),
  pdf: z.string().optional(),
  attachments: z.array(z.string()).optional(),
});

export type WoonbehoefteObjectData = z.infer<typeof woonbehoefteObjectDataSchema>;

/** Open Zaak document URLs end in `.../enkelvoudiginformatieobjecten/{uuid}`; the UUID is the document's own identifier. */
export function documentIdFromUrl(documentUrl: string): string {
  return documentUrl.replace(/\/$/, '').split('/').pop() ?? documentUrl;
}

export function toDocumentReference(url: string, role: SourceDocumentReference['role']): SourceDocumentReference {
  return { documentId: documentIdFromUrl(url), url, role };
}
