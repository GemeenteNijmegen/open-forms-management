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

function objectOn(date: string, uuid: string) {
  return sampleObject({ uuid, registrationAt: date });
}

describe('ObjectsClient registrationRange', () => {
  let fetchMock: jest.Mock;
  let client: ObjectsClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    client = new ObjectsClient(CONFIG, { fetch: fetchMock as unknown as typeof fetch });
    jest.spyOn(logger, 'debug').mockImplementation(() => {});
    jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  it('injects a descending record.registrationAt ordering when the caller specifies none', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, page([])));

    await collect(client.paginateObjects({}, { registrationRange: { from: '2026-08-01' } }));

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}objects?ordering=-record__registrationAt`);
  });

  it('stops the whole iterator, including further pages, once a record is below from, even mid-page', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, page(
          [objectOn('2026-08-18', 'a'), objectOn('2026-08-17', 'b'), objectOn('2026-08-12', 'c')],
          `${BASE_URL}objects?page=2`,
        )),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, page(
          [objectOn('2026-08-10', 'd'), objectOn('2026-08-09', 'e'), objectOn('2026-08-07', 'f')],
          `${BASE_URL}objects?page=3`,
        )),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, page(
          [objectOn('2026-08-05', 'g'), objectOn('2026-08-02', 'h'), objectOn('2026-08-01', 'i')],
          `${BASE_URL}objects?page=4`,
        )),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, page(
          [objectOn('2026-07-30', 'below-from'), objectOn('2026-07-20', 'never-reached')],
          `${BASE_URL}objects?page=5`,
        )),
      );

    const results = await collect(client.paginateObjects({}, { registrationRange: { from: '2026-08-01' } }));

    expect(results.map((object) => object.uuid)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('applies inclusive from and to bounds', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, page([objectOn('2026-08-20', 'a'), objectOn('2026-08-10', 'b'), objectOn('2026-08-01', 'c')])),
    );

    const results = await collect(
      client.paginateObjects({}, { registrationRange: { from: '2026-08-01', to: '2026-08-20' } }),
    );

    expect(results.map((object) => object.uuid)).toEqual(['a', 'b', 'c']);
  });

  it('skips records above to without stopping the iterator', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, page([objectOn('2026-08-20', 'too-new'), objectOn('2026-08-10', 'in-range')])),
    );

    const results = await collect(client.paginateObjects({}, { registrationRange: { to: '2026-08-15' } }));

    expect(results.map((object) => object.uuid)).toEqual(['in-range']);
  });

  it('with only from: yields until the first date below from and stops', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, page([objectOn('2026-08-20', 'a'), objectOn('2026-08-10', 'b'), objectOn('2026-08-01', 'below')])),
    );

    const results = await collect(client.paginateObjects({}, { registrationRange: { from: '2026-08-05' } }));

    expect(results.map((object) => object.uuid)).toEqual(['a', 'b']);
  });

  it('with only to: skips newer records without a date-based early stop', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, page([objectOn('2026-08-20', 'too-new')], `${BASE_URL}objects?page=2`)))
      .mockResolvedValueOnce(jsonResponse(200, page([objectOn('2025-01-01', 'very-old')])));

    const results = await collect(client.paginateObjects({}, { registrationRange: { to: '2026-08-15' } }));

    expect(results.map((object) => object.uuid)).toEqual(['very-old']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a caller ordering that does not start with descending record.registrationAt', async () => {
    await expect(
      collect(client.paginateObjects({ ordering: { path: ['uuid'] } }, { registrationRange: { from: '2026-08-01' } })),
    ).rejects.toThrow('registrationRange requires ordering');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a caller ordering that already starts with descending record.registrationAt', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, page([])));

    await collect(
      client.paginateObjects(
        { ordering: [{ path: ['record', 'registrationAt'], direction: 'desc' }, { path: ['record', 'index'] }] },
        { registrationRange: { from: '2026-08-01' } },
      ),
    );

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}objects?ordering=-record__registrationAt%2Crecord__index`);
  });

  it('rejects an invalid registrationRange.from date', async () => {
    await expect(collect(client.paginateObjects({}, { registrationRange: { from: 'not-a-date' } }))).rejects.toThrow('ISO date');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects registrationRange.from after registrationRange.to', async () => {
    await expect(
      collect(client.paginateObjects({}, { registrationRange: { from: '2026-08-20', to: '2026-08-01' } })),
    ).rejects.toThrow('must not be after');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a missing registrationAt during range use as invalid-response instead of guessing', async () => {
    const malformed = sampleObject({ uuid: 'x' });
    delete (malformed.record as Record<string, unknown>).registrationAt;
    fetchMock.mockResolvedValueOnce(jsonResponse(200, page([malformed])));

    await expect(
      collect(client.paginateObjects({}, { registrationRange: { from: '2026-08-01' } })),
    ).rejects.toMatchObject({ category: 'invalid-response' });
  });
});
