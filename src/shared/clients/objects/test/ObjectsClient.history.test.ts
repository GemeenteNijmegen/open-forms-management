import { BASE_URL, CONFIG, jsonResponse, page } from './fixtures';
import { logger } from '../../../../observability/Logger';
import { HttpClientError } from '../../http/HttpClientError';
import { ObjectsClient } from '../ObjectsClient';

const UUID = 'c48c6597-8034-4a10-9885-eb5a0863a61d';
const HISTORY_URL = `${BASE_URL}objects/${UUID}/history`;

function record(index: number, status: string): Record<string, unknown> {
  return { index, typeVersion: 7, data: { status }, startAt: '2026-10-02', registrationAt: '2026-10-02' };
}

describe('ObjectsClient getObjectHistory', () => {
  let fetchMock: jest.Mock;
  let client: ObjectsClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    client = new ObjectsClient(CONFIG, { fetch: fetchMock as unknown as typeof fetch });
    jest.spyOn(logger, 'debug').mockImplementation(() => {});
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  it('follows next and returns every record, also repeated statuses', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, page([record(1, 'open'), record(2, 'open')], `${HISTORY_URL}?page=2`, 4)))
      .mockResolvedValueOnce(jsonResponse(200, page([record(3, 'afgerond'), record(4, 'verwerkt')], null, 4)));

    const records = await client.getObjectHistory(UUID);

    expect(records.map((r) => [r.index, (r.data as { status: string }).status])).toEqual([[1, 'open'], [2, 'open'], [3, 'afgerond'], [4, 'verwerkt']]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([HISTORY_URL, `${HISTORY_URL}?page=2`]);
  });

  it('throws instead of returning fewer records than the API counted', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, page([record(1, 'open')], null, 2)));

    await expect(client.getObjectHistory(UUID)).rejects.toMatchObject({ category: 'invalid-response' });
  });

  it('rejects a next URL on another origin and maps a 403 to forbidden', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, page([record(1, 'open')], 'https://elders.example/objects/api/v2/x', 2)));
    await expect(client.getObjectHistory(UUID)).rejects.toMatchObject({ category: 'unsafe-url' });

    fetchMock.mockResolvedValueOnce(jsonResponse(403, {}));
    const error = await client.getObjectHistory(UUID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpClientError);
    expect(error).toMatchObject({ category: 'forbidden' });
  });
});
