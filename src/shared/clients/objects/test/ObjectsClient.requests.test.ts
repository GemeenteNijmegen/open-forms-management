import { BASE_URL, CONFIG, jsonResponse, page, sampleObject } from './fixtures';
import { logger } from '../../../../observability/Logger';
import { HttpClientError } from '../../http/HttpClientError';
import { ObjectsClient } from '../ObjectsClient';

describe('ObjectsClient getObjectByUuid/getObjectsList', () => {
  let fetchMock: jest.Mock;
  let client: ObjectsClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    client = new ObjectsClient(CONFIG, { fetch: fetchMock as unknown as typeof fetch });
    jest.spyOn(logger, 'debug').mockImplementation(() => {});
    jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  it('builds the correct URL and Authorization header for getObjectByUuid', async () => {
    const uuid = 'c48c6597-8034-4a10-9885-eb5a0863a61d';
    fetchMock.mockResolvedValue(jsonResponse(200, sampleObject({ uuid })));

    const object = await client.getObjectByUuid(uuid);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}objects/${uuid}`);
    expect(init.headers.Authorization).toBe('Token test-token');
    expect(init.headers.Accept).toBe('application/json');
    expect(object.uuid).toBe(uuid);
  });

  it('rejects an invalid UUID without making a request', async () => {
    await expect(client.getObjectByUuid('not-a-uuid')).rejects.toThrow('valid UUID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('performs exactly one request for getObjectsList using the query serializer', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, page([sampleObject()])));

    const result = await client.getObjectsList({ type: 'https://example.org/objecttypes/1', pageSize: 100 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}objects?type=https%3A%2F%2Fexample.org%2Fobjecttypes%2F1&pageSize=100`);
    expect(result.count).toBe(1);
    expect(result.results).toHaveLength(1);
  });

  it.each([
    [401, 'authentication'],
    [404, 'not-found'],
    [500, 'unknown'],
  ])('surfaces a non-2xx status %s as category %s through toHttpClientError', async (status, category) => {
    fetchMock.mockResolvedValue(jsonResponse(status, {}));

    await expect(client.getObjectByUuid('c48c6597-8034-4a10-9885-eb5a0863a61d')).rejects.toMatchObject({ category });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed response body as invalid-response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { not: 'an object with a record' }));

    await expect(client.getObjectByUuid('c48c6597-8034-4a10-9885-eb5a0863a61d')).rejects.toBeInstanceOf(HttpClientError);
  });

  it('never logs the api token, Authorization header or response body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, sampleObject({ data: { bsn: '123456789' } })));
    const debugSpy = logger.debug as jest.Mock;

    await client.getObjectByUuid('c48c6597-8034-4a10-9885-eb5a0863a61d');

    const loggedText = JSON.stringify(debugSpy.mock.calls);
    expect(loggedText).not.toContain('test-token');
    expect(loggedText).not.toContain('123456789');
  });
});
