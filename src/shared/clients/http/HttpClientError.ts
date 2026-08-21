export type HttpClientErrorCategory =
  | 'timeout'
  | 'network'
  | 'authentication'
  | 'forbidden'
  | 'not-found'
  | 'rate-limit'
  | 'unavailable'
  | 'invalid-response'
  | 'unsafe-url'
  | 'unknown';

/**
 * Thrown for operational failures (HTTP/network/response validation),
 * shared by every external API client in this project so callers can
 * branch on `category` without string parsing regardless of which client
 * raised it. Caller input mistakes detectable before any request (an
 * invalid query, an invalid JWT expiry) throw a plain `Error` instead.
 */
export class HttpClientError extends Error {
  public readonly category: HttpClientErrorCategory;

  constructor(category: HttpClientErrorCategory, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'HttpClientError';
    this.category = category;
  }
}
