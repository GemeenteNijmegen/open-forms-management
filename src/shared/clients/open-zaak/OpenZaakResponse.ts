import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { HttpClientError } from '../http/HttpClientError';

export interface OpenZaakDocumentMetadata {
  url?: string;
  identificatie?: string;
  titel?: string;
  formaat?: string;
  bestandsnaam?: string;
  bestandsomvang?: number;
  versie?: number;
  beginRegistratie?: string;
}

export interface OpenZaakDocumentContent {
  body: Uint8Array;
  contentType?: string;
  contentLength?: number;
  contentDisposition?: string;
}

/** Accepts unknown extra API properties without copying the full OpenAPI schema. */
export function parseOpenZaakDocumentMetadata(body: unknown): OpenZaakDocumentMetadata {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    logger.warn('Open Zaak document metadata response was not a JSON object', { receivedType: Array.isArray(body) ? 'array' : typeof body });
    throw new HttpClientError('invalid-response', 'Open Zaak document metadata response is not a JSON object');
  }
  const record = body as Record<string, unknown>;

  return {
    url: typeof record.url === 'string' ? record.url : undefined,
    identificatie: typeof record.identificatie === 'string' ? record.identificatie : undefined,
    titel: typeof record.titel === 'string' ? record.titel : undefined,
    formaat: typeof record.formaat === 'string' ? record.formaat : undefined,
    bestandsnaam: typeof record.bestandsnaam === 'string' ? record.bestandsnaam : undefined,
    bestandsomvang: typeof record.bestandsomvang === 'number' ? record.bestandsomvang : undefined,
    versie: typeof record.versie === 'number' ? record.versie : undefined,
    beginRegistratie: typeof record.beginRegistratie === 'string' ? record.beginRegistratie : undefined,
  };
}

/** Bytes stay exact; only a caller decoding as text should transform them. */
export async function readOpenZaakDocumentContent(response: Response): Promise<OpenZaakDocumentContent> {
  let buffer: ArrayBuffer;
  try {
    buffer = await response.arrayBuffer();
  } catch (error) {
    logger.warn('Open Zaak document download body could not be read', { reason: errorReason(error) });
    throw new HttpClientError('invalid-response', 'Open Zaak document download body could not be read', { cause: error });
  }

  const contentLengthHeader = response.headers.get('content-length');
  const contentLength = contentLengthHeader !== null && !Number.isNaN(Number(contentLengthHeader)) ? Number(contentLengthHeader) : undefined;

  return {
    body: new Uint8Array(buffer),
    contentType: response.headers.get('content-type') ?? undefined,
    contentLength,
    contentDisposition: response.headers.get('content-disposition') ?? undefined,
  };
}
