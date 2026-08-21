import { HttpClientError, HttpClientErrorCategory } from './HttpClientError';
import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';

/** A static header object (Objects' token) or a thunk called fresh per request (Open Zaak's per-attempt JWT). */
export type RequestHeaders = Record<string, string> | (() => Record<string, string>);

export interface HttpClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface HttpRequestOptions {
  headers?: RequestHeaders;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Small authenticated GET client with a hard timeout, shared by every external API client in this project. */
export class HttpClient {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly clientName: string, options: HttpClientOptions = {}) {
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async get(operation: string, url: string, options: HttpRequestOptions = {}): Promise<Response> {
    if (options.signal?.aborted) {
      throw new HttpClientError('unknown', `${this.clientName} request aborted by caller`);
    }

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeoutController.signal]) : timeoutController.signal;
    const startedAt = Date.now();

    try {
      const headers = typeof options.headers === 'function' ? options.headers() : options.headers;
      const response = await this.fetchFn(url, { method: 'GET', headers, signal });
      const durationMs = Date.now() - startedAt;
      logger.debug(`${this.clientName} request ${response.ok ? 'succeeded' : 'failed'}`, { operation, status: response.status, durationMs });
      return response;
    } catch (error) {
      const durationMs = Date.now() - startedAt;

      if (options.signal?.aborted) {
        logger.debug(`${this.clientName} request aborted`, { operation, durationMs });
        throw new HttpClientError('unknown', `${this.clientName} request aborted by caller`, { cause: error });
      }

      const category: HttpClientErrorCategory = timeoutController.signal.aborted ? 'timeout' : 'network';
      logger.debug(`${this.clientName} request errored`, { operation, durationMs, reason: category });
      throw new HttpClientError(category, `${this.clientName} request failed: ${errorReason(error)}`, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Maps a non-2xx response to a categorized error without dumping the response body into the message. */
export function toHttpClientError(clientName: string, operation: string, response: Response): HttpClientError {
  return new HttpClientError(mapStatusToCategory(response.status), `${clientName} ${operation} failed with status ${response.status}`);
}

/** Parses a JSON response body; a syntax error becomes invalid-response instead of a generic error. */
export async function readJsonBody(response: Response, context: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new HttpClientError('invalid-response', `${context} is not valid JSON`, { cause: error });
  }
}

function mapStatusToCategory(status: number): HttpClientErrorCategory {
  if (status === 401) return 'authentication';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limit';
  if (status === 502 || status === 503 || status === 504) return 'unavailable';
  return 'unknown';
}
