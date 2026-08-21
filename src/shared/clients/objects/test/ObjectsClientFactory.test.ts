import { AWS } from '@gemeentenijmegen/utils';
import { ObjectsClient } from '../ObjectsClient';
import { getObjectsClient, resetObjectsClientCache } from '../ObjectsClientFactory';
import { resetObjectsConfigurationCache } from '../ObjectsConfiguration';

jest.mock('@gemeentenijmegen/utils', () => ({
  ...jest.requireActual('@gemeentenijmegen/utils'),
  AWS: { getSecret: jest.fn() },
}));

describe('getObjectsClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    resetObjectsClientCache();
    resetObjectsConfigurationCache();
    process.env = {
      ...originalEnv,
      OBJECTS_BASE_URL: 'https://mijn-services.accp.nijmegen.nl/objects/api/v2/',
      OBJECTS_CREDENTIALS_SECRET_NAME: '/open-forms-management/objects/credentials',
    };
    (AWS.getSecret as jest.Mock).mockResolvedValue(JSON.stringify({ apiToken: 'test-token' }));
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns a usable ObjectsClient instance', async () => {
    const client = await getObjectsClient();

    expect(client).toBeInstanceOf(ObjectsClient);
  });

  it('reuses the same client and does not read the secret again on repeated calls', async () => {
    await getObjectsClient();
    await getObjectsClient();

    expect(AWS.getSecret).toHaveBeenCalledTimes(1);
  });

  it('reads the secret again after resetObjectsClientCache', async () => {
    await getObjectsClient();
    resetObjectsClientCache();
    resetObjectsConfigurationCache();
    await getObjectsClient();

    expect(AWS.getSecret).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed client construction', async () => {
    (AWS.getSecret as jest.Mock).mockRejectedValueOnce(new Error('AccessDeniedException'));

    await expect(getObjectsClient()).rejects.toThrow('AccessDeniedException');
    resetObjectsConfigurationCache();
    (AWS.getSecret as jest.Mock).mockResolvedValueOnce(JSON.stringify({ apiToken: 'test-token' }));

    await expect(getObjectsClient()).resolves.toBeInstanceOf(ObjectsClient);
  });
});
