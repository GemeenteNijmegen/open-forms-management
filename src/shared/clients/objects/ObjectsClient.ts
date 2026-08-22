import { ObjectsClientConfiguration } from './ObjectsConfiguration';
import { paginate, PageEnvelope } from './ObjectsPagination';
import { ObjectsQuery, serializeObjectsQuery } from './ObjectsQuery';
import { ObjectsRegistrationRange, requireValidRange, resolveRangeOrdering } from './ObjectsRegistrationRange';
import { ObjectResource, ObjectsPage, parseObjectResource, parseObjectsPage, requireRegistrationAt } from './ObjectsResponse';
import { logger } from '../../../observability/Logger';
import { HttpClient, HttpClientOptions, RequestHeaders, readJsonBody, toHttpClientError } from '../http/HttpClient';
import { HttpClientError } from '../http/HttpClientError';
import { isValidUuid } from '../utils/format';

export type ObjectsClientDependencies = HttpClientOptions;

export interface ObjectsIterationOptions {
  /** Counts yielded results after registrationRange filtering, not raw API rows. */
  maxResults?: number;
  signal?: AbortSignal;
  registrationRange?: ObjectsRegistrationRange;
}

type StopReason = 'next-null' | 'max-results' | 'registration-range' | 'aborted';

export class ObjectsClient {
  private readonly baseUrl: URL;
  private readonly http: HttpClient;
  private readonly headers: RequestHeaders;

  constructor(configuration: ObjectsClientConfiguration, dependencies: ObjectsClientDependencies = {}) {
    this.baseUrl = new URL(configuration.baseUrl);
    this.http = new HttpClient('objects', dependencies);
    this.headers = { Authorization: `Token ${configuration.apiToken}`, Accept: 'application/json' };
  }

  /** `GET /objects/{uuid}` */
  async getObjectByUuid(uuid: string, options: { signal?: AbortSignal } = {}): Promise<ObjectResource> {
    if (!isValidUuid(uuid)) {
      throw new Error('Objects getObjectByUuid requires a valid UUID');
    }
    const url = this.buildUrl(`objects/${uuid}`);
    const response = await this.http.get('getObjectByUuid', url, { headers: this.headers, signal: options.signal });
    if (!response.ok) {
      throw toHttpClientError('objects', 'getObjectByUuid', response);
    }
    const body = await readJsonBody(response, 'Objects object response');
    return parseObjectResource(body);
  }

  /** `GET /objects`, exactly one page. */
  async getObjectsList(query: ObjectsQuery = {}, options: { signal?: AbortSignal } = {}): Promise<ObjectsPage> {
    const url = this.buildUrl('objects', serializeObjectsQuery(query));
    return this.fetchObjectsPage('getObjectsList', url, options.signal);
  }

  /**
   * Follows `next` across pages, calling `getObjectsList` repeatedly. Stops
   * once `next` is `null`, `maxResults` yielded objects are reached, a
   * `registrationRange` early-stop triggers, or the caller aborts. Once it
   * stops, no further page is fetched.
   *
   * ```ts
   * for await (const object of client.paginateObjects(query, { maxResults: 50 })) {
   *   // one object at a time; nothing else is fetched once you stop consuming
   * }
   * ```
   *
   * Use `collectObjects` instead if you just want the results as an array.
   */
  async *paginateObjects(query: ObjectsQuery = {}, options: ObjectsIterationOptions = {}): AsyncGenerator<ObjectResource> {
    const { maxResults, signal, registrationRange } = options;
    if (maxResults !== undefined && (!Number.isInteger(maxResults) || maxResults < 1)) {
      throw new Error('Objects iteration maxResults must be a positive integer');
    }
    if (registrationRange) {
      requireValidRange(registrationRange);
    }

    const effectiveQuery: ObjectsQuery = registrationRange
      ? { ...query, ordering: resolveRangeOrdering(query.ordering) }
      : query;

    const startedAt = Date.now();
    let pagesFetched = 0;
    let objectsReceived = 0;
    let objectsYielded = 0;
    let stopReason: StopReason = 'next-null';

    const firstUrl = this.buildUrl('objects', serializeObjectsQuery(effectiveQuery));
    const fetchPage = async (url: string): Promise<PageEnvelope<ObjectResource>> => {
      const page = await this.fetchObjectsPage('paginateObjects', url, signal);
      pagesFetched += 1;
      objectsReceived += page.results.length;
      return page;
    };

    try {
      for await (const object of paginate(firstUrl, fetchPage, (next) => this.validateNextUrl(next), { signal })) {
        if (registrationRange) {
          const registrationAt = requireRegistrationAt(object);
          if (registrationRange.to && registrationAt > registrationRange.to) {
            continue;
          }
          if (registrationRange.from && registrationAt < registrationRange.from) {
            stopReason = 'registration-range';
            break;
          }
        }

        yield object;
        objectsYielded += 1;

        if (maxResults !== undefined && objectsYielded >= maxResults) {
          stopReason = 'max-results';
          break;
        }
      }

      if (stopReason === 'next-null' && signal?.aborted) {
        stopReason = 'aborted';
      }
    } finally {
      logger.debug('Objects iteration finished', {
        client: 'objects',
        operation: 'paginateObjects',
        pagesFetched,
        objectsReceived,
        objectsYielded,
        durationMs: Date.now() - startedAt,
        stopReason,
      });
    }
  }

  async collectObjects(query: ObjectsQuery = {}, options: ObjectsIterationOptions = {}): Promise<ObjectResource[]> {
    const results: ObjectResource[] = [];
    for await (const object of this.paginateObjects(query, options)) {
      results.push(object);
    }
    return results;
  }

  private async fetchObjectsPage(operation: string, url: string, signal?: AbortSignal): Promise<ObjectsPage> {
    const response = await this.http.get(operation, url, { headers: this.headers, signal });
    if (!response.ok) {
      throw toHttpClientError('objects', operation, response);
    }
    const body = await readJsonBody(response, 'Objects page response');
    return parseObjectsPage(body);
  }

  private buildUrl(path: string, params?: URLSearchParams): string {
    const url = new URL(path, this.baseUrl);
    const queryString = params?.toString();
    if (queryString) {
      url.search = queryString;
    }
    return url.toString();
  }

  /** Never follows `next` blindly: must stay https, same origin and under the configured Objects API root. */
  private validateNextUrl(next: string): string {
    let parsed: URL;
    try {
      parsed = new URL(next);
    } catch {
      throw this.rejectNextUrl('Objects next URL is not a valid absolute URL');
    }
    if (parsed.username || parsed.password) {
      throw this.rejectNextUrl('Objects next URL must not contain userinfo');
    }
    if (parsed.protocol !== 'https:') {
      throw this.rejectNextUrl('Objects next URL does not use https');
    }
    if (parsed.origin !== this.baseUrl.origin) {
      throw this.rejectNextUrl('Objects next URL does not match the configured origin');
    }
    if (!parsed.pathname.startsWith(this.baseUrl.pathname)) {
      throw this.rejectNextUrl('Objects next URL is outside the configured Objects API root');
    }
    return parsed.toString();
  }

  private rejectNextUrl(reason: string): HttpClientError {
    logger.warn('Objects rejected an unsafe next URL', { reason });
    return new HttpClientError('unsafe-url', reason);
  }
}
