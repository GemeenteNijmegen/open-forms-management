import { AWS } from '@gemeentenijmegen/utils';
import { loadOpenZaakConfiguration, resetOpenZaakConfigurationCache } from '../OpenZaakConfiguration';

jest.mock('@gemeentenijmegen/utils', () => ({
  ...jest.requireActual('@gemeentenijmegen/utils'),
  AWS: { getSecret: jest.fn() },
}));

describe('loadOpenZaakConfiguration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    resetOpenZaakConfigurationCache();
    process.env = {
      ...originalEnv,
      OPEN_ZAAK_DOCUMENTEN_BASE_URL: 'https://mijn-services.accp.nijmegen.nl/open-zaak/documenten/api/v1/',
      OPEN_ZAAK_CREDENTIALS_SECRET_NAME: '/open-forms-management/open-zaak/credentials',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('reads the base URL from the environment and clientId/clientSecret from Secrets Manager', async () => {
    (AWS.getSecret as jest.Mock).mockResolvedValue(JSON.stringify({ clientId: 'client-a', clientSecret: 'secret-a' }));

    const configuration = await loadOpenZaakConfiguration();

    expect(AWS.getSecret).toHaveBeenCalledWith(process.env.OPEN_ZAAK_CREDENTIALS_SECRET_NAME);
    expect(configuration).toEqual({
      baseUrl: 'https://mijn-services.accp.nijmegen.nl/open-zaak/documenten/api/v1/',
      clientId: 'client-a',
      clientSecret: 'secret-a',
    });
  });

  it.each(['OPEN_ZAAK_DOCUMENTEN_BASE_URL', 'OPEN_ZAAK_CREDENTIALS_SECRET_NAME'])('throws a clear error when %s is missing', async (missingVar) => {
    delete process.env[missingVar];

    await expect(loadOpenZaakConfiguration()).rejects.toThrow(missingVar);
    expect(AWS.getSecret).not.toHaveBeenCalled();
  });

  it.each([
    ['missing clientId', { clientSecret: 'b' }],
    ['missing clientSecret', { clientId: 'a' }],
    ['empty clientId', { clientId: '', clientSecret: 'b' }],
  ])('rejects a secret with %s', async (_description, body) => {
    (AWS.getSecret as jest.Mock).mockResolvedValue(JSON.stringify(body));

    await expect(loadOpenZaakConfiguration()).rejects.toThrow('missing clientId/clientSecret');
  });

  it('caches the resolved configuration within a warm module', async () => {
    (AWS.getSecret as jest.Mock).mockResolvedValue(JSON.stringify({ clientId: 'a', clientSecret: 'b' }));

    await loadOpenZaakConfiguration();
    await loadOpenZaakConfiguration();

    expect(AWS.getSecret).toHaveBeenCalledTimes(1);
  });

  it('reads the secret again after resetOpenZaakConfigurationCache', async () => {
    (AWS.getSecret as jest.Mock).mockResolvedValue(JSON.stringify({ clientId: 'a', clientSecret: 'b' }));

    await loadOpenZaakConfiguration();
    resetOpenZaakConfigurationCache();
    await loadOpenZaakConfiguration();

    expect(AWS.getSecret).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed load', async () => {
    (AWS.getSecret as jest.Mock).mockRejectedValueOnce(new Error('AccessDeniedException'));
    (AWS.getSecret as jest.Mock).mockResolvedValueOnce(JSON.stringify({ clientId: 'a', clientSecret: 'b' }));

    await expect(loadOpenZaakConfiguration()).rejects.toThrow('AccessDeniedException');
    await expect(loadOpenZaakConfiguration()).resolves.toEqual({
      baseUrl: 'https://mijn-services.accp.nijmegen.nl/open-zaak/documenten/api/v1/',
      clientId: 'a',
      clientSecret: 'b',
    });
  });
});
