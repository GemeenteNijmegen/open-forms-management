import { BASE_URL, CONFIG, jsonResponse, page, sampleObject } from './fixtures';
import { logger } from '../../../../observability/Logger';
import { ObjectsClient } from '../ObjectsClient';

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

describe('ObjectsClient maxResults and AbortSignal stop behavior', () => {
  let fetchMock: jest.Mock;
  let client: ObjectsClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    client = new ObjectsClient(CONFIG, { fetch: fetchMock as unknown as typeof fetch });
    jest.spyOn(logger, 'debug').mockImplementation(() => {});
    jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  it('stops exactly after maxResults yielded results within a single page', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, page([sampleObject({ uuid: 'a' }), sampleObject({ uuid: 'b' }), sampleObject({ uuid: 'c' })])),
    );

    const results = await collect(client.paginateObjects({}, { maxResults: 2 }));

    expect(results.map((object) => object.uuid)).toEqual(['a', 'b']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not fetch the next page once maxResults is reached exactly at a page boundary', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, page([sampleObject({ uuid: 'a' }), sampleObject({ uuid: 'b' })], `${BASE_URL}objects?page=2`)),
    );

    const results = await collect(client.paginateObjects({}, { maxResults: 2 }));

    expect(results.map((object) => object.uuid)).toEqual(['a', 'b']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('counts maxResults after registrationRange filtering, not raw server rows', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, page([
        sampleObject({ uuid: 'too-new', registrationAt: '2026-08-25' }),
        sampleObject({ uuid: 'a', registrationAt: '2026-08-10' }),
        sampleObject({ uuid: 'b', registrationAt: '2026-08-05' }),
      ])),
    );

    const results = await collect(client.paginateObjects({}, { maxResults: 2, registrationRange: { to: '2026-08-15' } }));

    expect(results.map((object) => object.uuid)).toEqual(['a', 'b']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-positive maxResults without making a request', async () => {
    await expect(collect(client.paginateObjects({}, { maxResults: 0 }))).rejects.toThrow('positive integer');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('makes zero requests when the signal is already aborted before the first call', async () => {
    const controller = new AbortController();
    controller.abort();

    const results = await collect(client.paginateObjects({}, { signal: controller.signal }));

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops without fetching a next page once the caller aborts between pages', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async () => {
      controller.abort();
      return jsonResponse(200, page([sampleObject()], `${BASE_URL}objects?page=2`));
    });

    const results = await collect(client.paginateObjects({}, { signal: controller.signal }));

    expect(results).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces an in-flight abort as an abort, not a generic network failure', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(() => {
      controller.abort();
      return Promise.reject(new Error('The operation was aborted'));
    });

    await expect(collect(client.paginateObjects({}, { signal: controller.signal }))).rejects.toMatchObject({ category: 'unknown' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('respects an AbortSignal on a single getObjectByUuid call', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(client.getObjectByUuid('c48c6597-8034-4a10-9885-eb5a0863a61d', { signal: controller.signal })).rejects.toMatchObject({
      category: 'unknown',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
