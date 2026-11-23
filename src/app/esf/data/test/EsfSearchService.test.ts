import { logger } from '../../../../observability/Logger';
import { ObjectsClient } from '../../../../shared/clients/objects/ObjectsClient';
import { BASE_URL, CONFIG, jsonResponse, page } from '../../../../shared/clients/objects/test/fixtures';
import { EsfSearchService } from '../EsfSearchService';

const TYPE_URL = 'https://example.com/objecttypes/api/v2/objecttypes/00000000-0000-4000-8000-000000000001';
const UUID_1 = '11111111-1111-4111-8111-111111111111';
const UUID_2 = '22222222-2222-4222-8222-222222222222';

// Fictieve taak met de velden die de bron ook heeft en die nooit in het resultaat mogen komen.
function taskData(status: string, periodenummer = '202610', dossiernummer = '90000001'): Record<string, unknown> {
  return {
    soort: 'formtaak',
    titel: 'Statusformulier periode oktober 2026 invullen',
    status,
    formtaak: {
      formulier: { soort: 'url', value: 'https://formulier.example/geheim-formulier' },
      data: { periodenummer, clientnummer: '100000001', dossiernummer, email: 'test@example.com', telefoon: '0600000000', inkhef: 'x' },
    },
    identificatie: { type: 'bsn', value: '999990019' },
    verloopdatum: '2026-10-31',
  };
}

function esfObject(uuid: string, data: Record<string, unknown>): Record<string, unknown> {
  return { url: `${BASE_URL}objects/${uuid}`, uuid, type: TYPE_URL, record: { index: 1, typeVersion: 7, data, startAt: '2026-10-02', registrationAt: '2026-10-02' } };
}

function historyRecord(index: number, data: Record<string, unknown>): Record<string, unknown> {
  return { index, typeVersion: 7, data, startAt: '2026-10-02', registrationAt: `2026-10-0${index + 1}` };
}

describe('EsfSearchService', () => {
  let fetchMock: jest.Mock;
  let service: EsfSearchService;

  beforeEach(() => {
    fetchMock = jest.fn();
    service = new EsfSearchService(new ObjectsClient(CONFIG, { fetch: fetchMock as unknown as typeof fetch }), TYPE_URL);
    jest.spyOn(logger, 'debug').mockImplementation(() => {});
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  it('filters on type, soort, period and number, and shows every task and record as received without other fields', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith(`${BASE_URL}objects?`)) {
        return jsonResponse(200, page([esfObject(UUID_2, taskData('verwerkt', '202610', '90000002')), esfObject(UUID_1, taskData('verwerkt'))]));
      }
      if (url.includes(UUID_1)) {
        return jsonResponse(200, page([historyRecord(3, taskData('afgerond')), historyRecord(1, taskData('open')), historyRecord(2, taskData('open')), historyRecord(4, taskData('verwerkt'))]));
      }
      const withoutStatus = { ...taskData('open', '202610', '90000002'), status: undefined };
      return jsonResponse(200, page([historyRecord(1, taskData('open', '202610', '90000002')), historyRecord(2, withoutStatus)]));
    });

    const result = await service.search({ periodenummer: '202610', searchType: 'clientnummer', searchValue: '100000001' });

    const listUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(listUrl.searchParams.get('type')).toBe(TYPE_URL);
    expect(listUrl.searchParams.getAll('data_attr')).toEqual([
      'soort__exact__formtaak', 'formtaak__data__periodenummer__exact__202610', 'formtaak__data__clientnummer__exact__100000001',
    ]);
    expect(result).toEqual({
      outcome: 'FOUND',
      tasks: [
        {
          objectUuid: UUID_1,
          periodenummer: '202610',
          clientnummer: '100000001',
          dossiernummer: '90000001',
          records: [
            { index: 1, status: 'open', registrationAt: '2026-10-02' },
            { index: 2, status: 'open', registrationAt: '2026-10-03' },
            { index: 3, status: 'afgerond', registrationAt: '2026-10-04' },
            { index: 4, status: 'verwerkt', registrationAt: '2026-10-05' },
          ],
        },
        {
          objectUuid: UUID_2,
          periodenummer: '202610',
          clientnummer: '100000001',
          dossiernummer: '90000002',
          records: [{ index: 1, status: 'open', registrationAt: '2026-10-02' }, { index: 2, status: undefined, registrationAt: '2026-10-03' }],
        },
      ],
    });
    const output = JSON.stringify(result);
    for (const secret of ['999990019', 'test@example.com', '0600000000', 'geheim-formulier', 'Statusformulier', 'bsn']) {
      expect(output).not.toContain(secret);
    }
  });

  it('skips an object that does not match the period after the API filter', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith(`${BASE_URL}objects?`)) {
        return jsonResponse(200, page([esfObject(UUID_1, taskData('open')), esfObject(UUID_2, taskData('open', '202611'))]));
      }
      return jsonResponse(200, page([historyRecord(1, taskData('open'))]));
    });

    const result = await service.search({ periodenummer: '202610', searchType: 'clientnummer', searchValue: '100000001' });

    expect(result).toEqual({
      outcome: 'FOUND',
      tasks: [{
        objectUuid: UUID_1,
        periodenummer: '202610',
        clientnummer: '100000001',
        dossiernummer: '90000001',
        records: [{ index: 1, status: 'open', registrationAt: '2026-10-02' }],
      }],
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes(UUID_2))).toHaveLength(0);
  });

  it('returns NOT_FOUND only for an empty list, and lets a history failure through', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, page([])));
    await expect(service.search({ periodenummer: '202610', searchType: 'dossiernummer', searchValue: '90000001' })).resolves.toEqual({ outcome: 'NOT_FOUND' });

    fetchMock.mockResolvedValueOnce(jsonResponse(200, page([esfObject(UUID_1, taskData('open'))]))).mockResolvedValueOnce(jsonResponse(503, {}));
    await expect(service.search({ periodenummer: '202610', searchType: 'dossiernummer', searchValue: '90000001' }))
      .rejects.toMatchObject({ category: 'unavailable' });
  });
});
