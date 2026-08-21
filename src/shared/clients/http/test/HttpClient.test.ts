import { jsonResponse } from './fixtures';
import { logger } from '../../../../observability/Logger';
import { HttpClient, readJsonBody, toHttpClientError } from '../HttpClient';

describe('HttpClient.get', () => {
  let fetchMock: jest.Mock;
  let client: HttpClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    client = new HttpClient('test-client', { fetch: fetchMock as unknown as typeof fetch });
    jest.spyOn(logger, 'debug').mockImplementation(() => {});
  });

  it('returns the response as-is, including a non-2xx status', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, {}));

    const response = await client.get('op', 'https://example.org/x');

    expect(response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('applies a static headers object', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await client.get('op', 'https://example.org/x', { headers: { Authorization: 'Bearer fake' } });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer fake');
  });

  it('calls a headers thunk fresh on every request', async () => {
    let calls = 0;
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await client.get('op', 'https://example.org/x', { headers: () => ({ Authorization: `Bearer jwt-${++calls}` }) });
    await client.get('op', 'https://example.org/x', { headers: () => ({ Authorization: `Bearer jwt-${++calls}` }) });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-1');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer jwt-2');
  });

  it('treats a request exceeding the timeout as a timeout category', async () => {
    const abortAwareFetch = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const timeoutClient = new HttpClient('test-client', { fetch: abortAwareFetch as unknown as typeof fetch, timeoutMs: 5 });

    await expect(timeoutClient.get('op', 'https://example.org/x')).rejects.toMatchObject({ category: 'timeout' });
  });

  it('makes zero requests when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(client.get('op', 'https://example.org/x', { signal: controller.signal })).rejects.toMatchObject({ category: 'unknown' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces an in-flight abort as an abort, not a generic network failure', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(() => {
      controller.abort();
      return Promise.reject(new Error('The operation was aborted'));
    });

    await expect(client.get('op', 'https://example.org/x', { signal: controller.signal })).rejects.toMatchObject({ category: 'unknown' });
  });

  it('never logs a header value', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    const debugSpy = logger.debug as jest.Mock;

    await client.get('op', 'https://example.org/x', { headers: { Authorization: 'Bearer fake-secret' } });

    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain('fake-secret');
  });
});

describe('toHttpClientError', () => {
  it.each([
    [401, 'authentication'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [429, 'rate-limit'],
    [503, 'unavailable'],
    [500, 'unknown'],
  ])('maps status %s to category %s', (status, category) => {
    expect(toHttpClientError('client', 'op', jsonResponse(status, {}))).toMatchObject({ category });
  });
});

describe('readJsonBody', () => {
  it('returns the parsed body', async () => {
    await expect(readJsonBody(jsonResponse(200, { a: 1 }), 'context')).resolves.toEqual({ a: 1 });
  });

  it('rejects a body that is not valid JSON as invalid-response', async () => {
    const malformed = {
      json: async () => {
        throw new SyntaxError('bad json');
      },
    } as unknown as Response;

    await expect(readJsonBody(malformed, 'context')).rejects.toMatchObject({ category: 'invalid-response' });
  });
});
