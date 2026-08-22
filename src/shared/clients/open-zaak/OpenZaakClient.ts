import { z } from 'zod';
import { OpenZaakClientConfiguration } from './OpenZaakConfiguration';
import { signOpenZaakJwt } from './OpenZaakJwt';
import { OpenZaakDocumentContent, OpenZaakDocumentMetadata, parseOpenZaakDocumentMetadata, readOpenZaakDocumentContent } from './OpenZaakResponse';
import { logger } from '../../../observability/Logger';
import { EmployeeIdentity } from '../../auth/EmployeeIdentity';
import { HttpClient, HttpClientOptions, readJsonBody, toHttpClientError } from '../http/HttpClient';

export interface OpenZaakClientDependencies extends HttpClientOptions {
  now?: () => Date;
}

const documentUrlSchema = z.string().url();

export class OpenZaakClient {
  private readonly http: HttpClient;
  private readonly nowFn: () => Date;

  constructor(private readonly configuration: OpenZaakClientConfiguration, dependencies: OpenZaakClientDependencies = {}) {
    this.http = new HttpClient('open-zaak', dependencies);
    this.nowFn = dependencies.now ?? (() => new Date());
  }

  /** `GET {documentUrl}` (`enkelvoudiginformatieobject_read`). `documentUrl` is Objects' `record.data.csv`/`pdf`. */
  async getDocumentMetadata(documentUrl: string, actor: EmployeeIdentity, options: { signal?: AbortSignal } = {}): Promise<OpenZaakDocumentMetadata> {
    const url = requireValidUrl(documentUrl);
    const response = await this.http.get('metadata', url, { headers: this.jwtHeaders(actor), signal: options.signal });
    if (!response.ok) {
      throw toHttpClientError('open-zaak', 'metadata', response);
    }
    const body = await readJsonBody(response, 'Open Zaak document metadata response');
    return parseOpenZaakDocumentMetadata(body);
  }

  /** `GET {documentUrl}/download` (`enkelvoudiginformatieobject_download`). */
  async getDocumentContent(documentUrl: string, actor: EmployeeIdentity, options: { signal?: AbortSignal } = {}): Promise<OpenZaakDocumentContent> {
    const url = `${requireValidUrl(documentUrl).replace(/\/$/, '')}/download`;
    const response = await this.http.get('download', url, { headers: this.jwtHeaders(actor), signal: options.signal });
    if (!response.ok) {
      throw toHttpClientError('open-zaak', 'download', response);
    }
    const content = await readOpenZaakDocumentContent(response);
    logger.debug('Open Zaak download completed', { client: 'open-zaak', operation: 'download', byteCount: content.body.byteLength });
    return content;
  }

  /** Decodes the same download as UTF-8 text; no second network architecture for CSV. */
  async getDocumentText(documentUrl: string, actor: EmployeeIdentity, options: { signal?: AbortSignal } = {}): Promise<string> {
    const content = await this.getDocumentContent(documentUrl, actor, options);
    return new TextDecoder('utf-8').decode(content.body);
  }

  /** A thunk, not a precomputed header: `HttpClient` calls this fresh for every real HTTP attempt, so the JWT is never reused or cached. */
  private jwtHeaders(actor: EmployeeIdentity): () => Record<string, string> {
    return () => ({ Authorization: `Bearer ${signOpenZaakJwt(this.configuration, actor, { now: this.nowFn })}` });
  }
}

function requireValidUrl(value: string): string {
  const result = documentUrlSchema.safeParse(value);
  if (!result.success) {
    throw new Error('Open Zaak document reference is not a valid URL');
  }
  return result.data;
}
