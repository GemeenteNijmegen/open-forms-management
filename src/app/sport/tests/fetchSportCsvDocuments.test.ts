import { logger } from '../../../observability/Logger';
import { ObjectResource } from '../../../shared/clients/objects/ObjectsResponse';
import { OpenZaakClient } from '../../../shared/clients/open-zaak/OpenZaakClient';
import { fetchSportCsvDocuments } from '../fetchSportCsvDocuments';

function buildObject(reference: string, csv: string, uuid?: string): ObjectResource {
  return { uuid, record: { data: { reference, csv } } } as ObjectResource;
}

const actor = { principalId: 'employee-1' };

describe('fetchSportCsvDocuments', () => {
  it('never runs more than the fixed concurrency of document downloads at once', async () => {
    const objects = Array.from({ length: 10 }, (_, i) => buildObject(`ref-${i}`, `csv-${i}`));
    let active = 0;
    let maxActive = 0;

    const getDocumentText = jest.fn().mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return 'csv-text';
    });
    const client = { getDocumentText } as unknown as OpenZaakClient;

    const result = await fetchSportCsvDocuments(client, objects, actor);

    expect(maxActive).toBe(4);
    expect(result.documents).toHaveLength(10);
    expect(result.failedCount).toBe(0);
  });

  it('skips a document that fails to download and counts it, without failing the others', async () => {
    const objects = [buildObject('ref-ok', 'csv-ok'), buildObject('ref-fail', 'csv-fail', 'object-uuid-fail')];
    const getDocumentText = jest.fn()
      .mockResolvedValueOnce('csv-text')
      .mockRejectedValueOnce(new Error('download failed'));
    const client = { getDocumentText } as unknown as OpenZaakClient;
    jest.spyOn(logger, 'warn').mockImplementation(() => { });

    const result = await fetchSportCsvDocuments(client, objects, actor);

    expect(result.documents).toEqual([{ reference: 'ref-ok', csvText: 'csv-text', documentUrl: 'csv-ok' }]);
    expect(result.failedCount).toBe(1);
    expect(result.failedDocuments).toEqual([{ reference: 'ref-fail', objectUuid: 'object-uuid-fail' }]);
    // OF-nummer, objectnummer en de csv-url moeten in de log staan, zodat een mislukte download snel is op te zoeken.
    expect(logger.warn).toHaveBeenCalledWith('Sport CSV document fetch failed', expect.objectContaining({
      reference: 'ref-fail',
      objectUuid: 'object-uuid-fail',
      documentUrl: 'csv-fail',
    }));
  });

  it('skips an object whose record.data is missing reference/csv, without calling Open Zaak', async () => {
    const objects = [{ uuid: 'object-uuid-invalid', record: { data: { foo: 'bar' } } } as ObjectResource];
    const getDocumentText = jest.fn();
    const client = { getDocumentText } as unknown as OpenZaakClient;

    const result = await fetchSportCsvDocuments(client, objects, actor);

    expect(getDocumentText).not.toHaveBeenCalled();
    expect(result.documents).toEqual([]);
    expect(result.failedCount).toBe(1);
    // Geen reference bekend (dat is precies wat hier mislukte), maar het objectnummer wel: nog steeds op te zoeken.
    expect(result.failedDocuments).toEqual([{ objectUuid: 'object-uuid-invalid' }]);
  });
});
