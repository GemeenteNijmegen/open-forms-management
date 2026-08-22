import { AWS } from '@gemeentenijmegen/utils';
import { CONFIG, DOCUMENT_REFERENCE, jsonResponse, metadataBody } from './fixtures';
import { EmployeeIdentity } from '../../../auth/EmployeeIdentity';
import { OpenZaakClient } from '../OpenZaakClient';
import { getOpenZaakClient, resetOpenZaakClientCache } from '../OpenZaakClientFactory';
import { resetOpenZaakConfigurationCache } from '../OpenZaakConfiguration';

jest.mock('@gemeentenijmegen/utils', () => ({
  ...jest.requireActual('@gemeentenijmegen/utils'),
  AWS: { getSecret: jest.fn() },
}));

function decodeJwt(authorizationHeader: string): Record<string, unknown> {
  const jwt = authorizationHeader.replace(/^Bearer /, '');
  const [, payloadPart] = jwt.split('.');
  return JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
}

describe('getOpenZaakClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    resetOpenZaakClientCache();
    resetOpenZaakConfigurationCache();
    process.env = {
      ...originalEnv,
      OPEN_ZAAK_DOCUMENTEN_BASE_URL: 'https://mijn-services.accp.nijmegen.nl/open-zaak/documenten/api/v1/',
      OPEN_ZAAK_CREDENTIALS_SECRET_NAME: '/open-forms-management/open-zaak/credentials',
    };
    (AWS.getSecret as jest.Mock).mockResolvedValue(JSON.stringify({ clientId: 'client-a', clientSecret: 'secret-a' }));
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns a usable OpenZaakClient instance', async () => {
    const client = await getOpenZaakClient();

    expect(client).toBeInstanceOf(OpenZaakClient);
  });

  it('reuses the same client and does not read the secret again on repeated calls', async () => {
    await getOpenZaakClient();
    await getOpenZaakClient();

    expect(AWS.getSecret).toHaveBeenCalledTimes(1);
  });

  it('reads the secret again after resetOpenZaakClientCache', async () => {
    await getOpenZaakClient();
    resetOpenZaakClientCache();
    resetOpenZaakConfigurationCache();
    await getOpenZaakClient();

    expect(AWS.getSecret).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed client construction', async () => {
    (AWS.getSecret as jest.Mock).mockRejectedValueOnce(new Error('AccessDeniedException'));

    await expect(getOpenZaakClient()).rejects.toThrow('AccessDeniedException');
    resetOpenZaakConfigurationCache();
    (AWS.getSecret as jest.Mock).mockResolvedValueOnce(JSON.stringify({ clientId: 'client-a', clientSecret: 'secret-a' }));

    await expect(getOpenZaakClient()).resolves.toBeInstanceOf(OpenZaakClient);
  });

  it('keeps the actor request-scoped: two actors on the same client instance get correctly distinct tokens', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(200, metadataBody()));
    const client = new OpenZaakClient(CONFIG, { fetch: fetchMock as unknown as typeof fetch });
    const actorA: EmployeeIdentity = { principalId: 'employee-a', email: 'a@nijmegen.nl' };
    const actorB: EmployeeIdentity = { principalId: 'employee-b', email: 'b@nijmegen.nl' };

    await client.getDocumentMetadata(DOCUMENT_REFERENCE, actorA);
    await client.getDocumentMetadata(DOCUMENT_REFERENCE, actorB);

    const claimsA = decodeJwt(fetchMock.mock.calls[0][1].headers.Authorization);
    const claimsB = decodeJwt(fetchMock.mock.calls[1][1].headers.Authorization);
    expect(claimsA.user_id).toBe('employee-a');
    expect(claimsB.user_id).toBe('employee-b');
  });
});
