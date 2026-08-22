import { AWS } from '@gemeentenijmegen/utils';
import { loadObjectsConfiguration, resetObjectsConfigurationCache } from '../ObjectsConfiguration';

jest.mock('@gemeentenijmegen/utils', () => ({
  ...jest.requireActual('@gemeentenijmegen/utils'),
  AWS: { getSecret: jest.fn() },
}));

describe('loadObjectsConfiguration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    resetObjectsConfigurationCache();
    process.env = {
      ...originalEnv,
      OBJECTS_BASE_URL: 'https://mijn-services.accp.nijmegen.nl/objects/api/v2/',
      OBJECTS_CREDENTIALS_SECRET_NAME: '/open-forms-management/objects/credentials',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('reads the base URL from the environment and the api token from Secrets Manager', async () => {
    (AWS.getSecret as jest.Mock).mockResolvedValue(JSON.stringify({ apiToken: 'the-real-token' }));

    const configuration = await loadObjectsConfiguration();

    expect(AWS.getSecret).toHaveBeenCalledWith(process.env.OBJECTS_CREDENTIALS_SECRET_NAME);
    expect(configuration).toEqual({
      baseUrl: 'https://mijn-services.accp.nijmegen.nl/objects/api/v2/',
      apiToken: 'the-real-token',
    });
  });

  it.each(['OBJECTS_BASE_URL', 'OBJECTS_CREDENTIALS_SECRET_NAME'])(
    'throws a clear error when %s is missing',
    async (missingVar) => {
      delete process.env[missingVar];

      await expect(loadObjectsConfiguration()).rejects.toThrow(missingVar);
      expect(AWS.getSecret).not.toHaveBeenCalled();
    },
  );

  it('rejects a secret that is missing apiToken', async () => {
    (AWS.getSecret as jest.Mock).mockResolvedValue(JSON.stringify({ somethingElse: 'value' }));

    await expect(loadObjectsConfiguration()).rejects.toThrow('Objects credentials secret is missing apiToken');
  });

  it('caches the resolved configuration within a warm module', async () => {
    (AWS.getSecret as jest.Mock).mockResolvedValue(JSON.stringify({ apiToken: 'token' }));

    await loadObjectsConfiguration();
    await loadObjectsConfiguration();

    expect(AWS.getSecret).toHaveBeenCalledTimes(1);
  });

  it('reads the secret again after resetObjectsConfigurationCache', async () => {
    (AWS.getSecret as jest.Mock).mockResolvedValue(JSON.stringify({ apiToken: 'token' }));

    await loadObjectsConfiguration();
    resetObjectsConfigurationCache();
    await loadObjectsConfiguration();

    expect(AWS.getSecret).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed load', async () => {
    (AWS.getSecret as jest.Mock).mockRejectedValueOnce(new Error('AccessDeniedException'));
    (AWS.getSecret as jest.Mock).mockResolvedValueOnce(JSON.stringify({ apiToken: 'token' }));

    await expect(loadObjectsConfiguration()).rejects.toThrow('AccessDeniedException');
    await expect(loadObjectsConfiguration()).resolves.toEqual({
      baseUrl: 'https://mijn-services.accp.nijmegen.nl/objects/api/v2/',
      apiToken: 'token',
    });
  });
});
