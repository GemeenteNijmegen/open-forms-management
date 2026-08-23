import { ObjectsClient } from '../../../../shared/clients/objects/ObjectsClient';
import { collectSportObjectsFrom } from '../SportObjectsQuery';

describe('collectSportObjectsFrom', () => {
  it('queries Aanmelden sportactiviteit objects from an arbitrary given date, newest first', async () => {
    const collectObjects = jest.fn().mockResolvedValue([]);
    const client = { collectObjects } as unknown as ObjectsClient;

    await collectSportObjectsFrom(client, '2026-07-23');

    expect(collectObjects).toHaveBeenCalledWith(
      { dataFilters: [{ path: ['formName'], operator: 'exact', value: 'Aanmelden sportactiviteit' }] },
      { registrationRange: { from: '2026-07-23' } },
    );
  });
});
