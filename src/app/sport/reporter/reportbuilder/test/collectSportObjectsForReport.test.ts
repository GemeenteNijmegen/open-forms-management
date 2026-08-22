import { ObjectsClient } from '../../../../../shared/clients/objects/ObjectsClient';
import { collectSportObjectsForReport } from '../collectSportObjectsForReport';

describe('collectSportObjectsForReport', () => {
  it('queries Aanmelden sportactiviteit objects for the requested range, independent of the current season', async () => {
    const collectObjects = jest.fn().mockResolvedValue([]);
    const client = { collectObjects } as unknown as ObjectsClient;

    await collectSportObjectsForReport(client, '2020-01-01', '2026-01-31');

    expect(collectObjects).toHaveBeenCalledWith(
      { dataFilters: [{ path: ['formName'], operator: 'exact', value: 'Aanmelden sportactiviteit' }] },
      { registrationRange: { from: '2020-01-01', to: '2026-01-31' } },
    );
  });
});
