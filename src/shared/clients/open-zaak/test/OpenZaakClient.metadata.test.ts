import { ACTOR, CONFIG, DOCUMENT_REFERENCE, jsonResponse, metadataBody } from './fixtures';
import { logger } from '../../../../observability/Logger';
import { HttpClientError } from '../../http/HttpClientError';
import { OpenZaakClient } from '../OpenZaakClient';

function decodeJwt(authorizationHeader: string): Record<string, unknown> {
  const jwt = authorizationHeader.replace(/^Bearer /, '');
  const [, payloadPart] = jwt.split('.');
  return JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
}

describe('OpenZaakClient.getDocumentMetadata', () => {
  let fetchMock: jest.Mock;
  let client: OpenZaakClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    client = new OpenZaakClient(CONFIG, { fetch: fetchMock as unknown as typeof fetch });
    jest.spyOn(logger, 'debug').mockImplementation(() => {});
    jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  it('requests the metadata URL built from the validated reference with a Bearer JWT', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, metadataBody()));

    const metadata = await client.getDocumentMetadata(DOCUMENT_REFERENCE, ACTOR);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DOCUMENT_REFERENCE);
    expect(init.headers.Authorization).toMatch(/^Bearer /);
    const claims = decodeJwt(init.headers.Authorization);
    expect(claims).toMatchObject({ client_id: 'test-client', user_id: ACTOR.principalId, user_representation: ACTOR.email });
    expect(metadata.titel).toBe('Aanmelding sportactiviteit.csv');
  });

  it('accepts unknown extra API properties without breaking', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, metadataBody({ futureField: 'value' })));

    const metadata = await client.getDocumentMetadata(DOCUMENT_REFERENCE, ACTOR);

    expect(metadata.identificatie).toBe('DOC-2026-0001');
  });

  it('rejects a metadata response that is not a JSON object as invalid-response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, 'not-an-object'));

    await expect(client.getDocumentMetadata(DOCUMENT_REFERENCE, ACTOR)).rejects.toBeInstanceOf(HttpClientError);
  });

  it.each([401, 403, 404, 500])('maps status %s to a distinct error category', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse(status, {}));

    await expect(client.getDocumentMetadata(DOCUMENT_REFERENCE, ACTOR)).rejects.toBeInstanceOf(HttpClientError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never logs the JWT, Authorization header or actor values', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, metadataBody()));
    const debugSpy = logger.debug as jest.Mock;

    await client.getDocumentMetadata(DOCUMENT_REFERENCE, ACTOR);

    const loggedText = JSON.stringify(debugSpy.mock.calls);
    expect(loggedText).not.toContain('test-secret');
    expect(loggedText).not.toContain(ACTOR.email);
    expect(loggedText).not.toContain(ACTOR.principalId);
  });

  it('rejects a reference that is not a valid URL without making a request', async () => {
    await expect(client.getDocumentMetadata('not-a-url', ACTOR)).rejects.toThrow('valid URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
