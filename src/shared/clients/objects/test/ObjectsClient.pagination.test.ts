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

describe('ObjectsClient paginateObjects/collectObjects pagination', () => {
  let fetchMock: jest.Mock;
  let client: ObjectsClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    client = new ObjectsClient(CONFIG, { fetch: fetchMock as unknown as typeof fetch });
    jest.spyOn(logger, 'debug').mockImplementation(() => {});
    jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  it('yields the results of a single page and stops at next: null', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, page([sampleObject({ uuid: 'c48c6597-8034-4a10-9885-eb5a0863a61d' })])));

    const results = await collect(client.paginateObjects());

    expect(results).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows next across three pages in server order and sequentially', async () => {
    const object1 = sampleObject({ uuid: 'c48c6597-8034-4a10-9885-eb5a0863a61d' });
    const object2 = sampleObject({ uuid: '2b22ef6f-5b84-4955-9875-b965faf1397b' });
    const object3 = sampleObject({ uuid: '8685f783-9b2f-4c71-b5f9-7f2630ac620e' });

    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, page([object1], `${BASE_URL}objects?page=2`)))
      .mockResolvedValueOnce(jsonResponse(200, page([object2], `${BASE_URL}objects?page=3`)))
      .mockResolvedValueOnce(jsonResponse(200, page([object3], null)));

    const results = await collect(client.paginateObjects());

    expect(results.map((object) => object.uuid)).toEqual([object1.uuid, object2.uuid, object3.uuid]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}objects`);
    expect(fetchMock.mock.calls[1][0]).toBe(`${BASE_URL}objects?page=2`);
    expect(fetchMock.mock.calls[2][0]).toBe(`${BASE_URL}objects?page=3`);
  });

  it('collectObjects uses the same iterator semantics as an array', async () => {
    const object1 = sampleObject({ uuid: 'c48c6597-8034-4a10-9885-eb5a0863a61d' });
    const object2 = sampleObject({ uuid: '2b22ef6f-5b84-4955-9875-b965faf1397b' });

    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, page([object1], `${BASE_URL}objects?page=2`)))
      .mockResolvedValueOnce(jsonResponse(200, page([object2], null)));

    const results = await client.collectObjects();

    expect(results.map((object) => object.uuid)).toEqual([object1.uuid, object2.uuid]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never fetches a next URL on a different origin', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, page([sampleObject()], 'https://evil.example.com/objects/api/v2/objects?page=2')),
    );

    await expect(collect(client.paginateObjects())).rejects.toMatchObject({ category: 'unsafe-url' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never fetches a next URL outside the configured Objects API root', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, page([sampleObject()], 'https://mijn-services.accp.nijmegen.nl/objects/api/v3/objects?page=2')),
    );

    await expect(collect(client.paginateObjects())).rejects.toMatchObject({ category: 'unsafe-url' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never fetches a non-https next URL', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, page([sampleObject()], 'http://mijn-services.accp.nijmegen.nl/objects/api/v2/objects?page=2')),
    );

    await expect(collect(client.paginateObjects())).rejects.toMatchObject({ category: 'unsafe-url' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never fetches a next URL containing userinfo', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, page([sampleObject()], 'https://user:pass@mijn-services.accp.nijmegen.nl/objects/api/v2/objects?page=2')),
    );

    await expect(collect(client.paginateObjects())).rejects.toMatchObject({ category: 'unsafe-url' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed next URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, page([sampleObject()], 'not a valid url')));

    await expect(collect(client.paginateObjects())).rejects.toMatchObject({ category: 'unsafe-url' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
