import { ObjectsClient } from '../../../../shared/clients/objects/ObjectsClient';
import { collectSportObjects } from '../SportObjectsQuery';

describe('collectSportObjects', () => {
  it('queries Aanmelden sportactiviteit objects from the current season start, newest first', async () => {
    const collectObjects = jest.fn().mockResolvedValue([]);
    const client = { collectObjects } as unknown as ObjectsClient;

    await collectSportObjects(client, new Date('2026-08-20T12:00:00Z'));

    expect(collectObjects).toHaveBeenCalledWith(
      { dataFilters: [{ path: ['formName'], operator: 'exact', value: 'Aanmelden sportactiviteit' }] },
      { registrationRange: { from: '2026-08-01' } },
    );
  });

  it('uses the previous season start just before 1 August', async () => {
    const collectObjects = jest.fn().mockResolvedValue([]);
    const client = { collectObjects } as unknown as ObjectsClient;

    await collectSportObjects(client, new Date('2026-03-15T12:00:00Z'));

    expect(collectObjects).toHaveBeenCalledWith(expect.anything(), { registrationRange: { from: '2025-08-01' } });
  });
});
