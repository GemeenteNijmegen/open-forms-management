import { ACTOR, binaryResponse, CONFIG, DOCUMENT_REFERENCE } from './fixtures';
import { logger } from '../../../../observability/Logger';
import { OpenZaakClient } from '../OpenZaakClient';

describe('OpenZaakClient.getDocumentContent/getDocumentText', () => {
  let fetchMock: jest.Mock;
  let client: OpenZaakClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    client = new OpenZaakClient(CONFIG, { fetch: fetchMock as unknown as typeof fetch });
    jest.spyOn(logger, 'debug').mockImplementation(() => {});
    jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  it('requests the /download URL with a Bearer JWT', async () => {
    const bytes = new Uint8Array([1, 2, 3, 255, 0]);
    fetchMock.mockResolvedValue(binaryResponse(200, bytes));

    const content = await client.getDocumentContent(DOCUMENT_REFERENCE, ACTOR);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${DOCUMENT_REFERENCE}/download`);
    expect(init.headers.Authorization).toMatch(/^Bearer /);
    expect(content.body).toEqual(bytes);
  });

  it('keeps binary bytes exact even when they are not valid text', async () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x10, 0x80, 0x7f]);
    fetchMock.mockResolvedValue(binaryResponse(200, bytes));

    const content = await client.getDocumentContent(DOCUMENT_REFERENCE, ACTOR);

    expect(Array.from(content.body)).toEqual(Array.from(bytes));
  });

  it('surfaces content type, length and disposition headers when present', async () => {
    const bytes = new TextEncoder().encode('a,b,c\n');
    fetchMock.mockResolvedValue(
      binaryResponse(200, bytes, {
        'content-type': 'text/csv',
        'content-length': String(bytes.byteLength),
        'content-disposition': 'attachment; filename="aanmelding.csv"',
      }),
    );

    const content = await client.getDocumentContent(DOCUMENT_REFERENCE, ACTOR);

    expect(content.contentType).toBe('text/csv');
    expect(content.contentLength).toBe(bytes.byteLength);
    expect(content.contentDisposition).toBe('attachment; filename="aanmelding.csv"');
  });

  it('leaves headers undefined when the response does not provide them', async () => {
    fetchMock.mockResolvedValue(binaryResponse(200, new Uint8Array()));

    const content = await client.getDocumentContent(DOCUMENT_REFERENCE, ACTOR);

    expect(content.contentType).toBeUndefined();
    expect(content.contentLength).toBeUndefined();
    expect(content.contentDisposition).toBeUndefined();
  });

  it('leaves contentLength undefined for an invalid content-length header', async () => {
    fetchMock.mockResolvedValue(binaryResponse(200, new Uint8Array([1]), { 'content-length': 'not-a-number' }));

    const content = await client.getDocumentContent(DOCUMENT_REFERENCE, ACTOR);

    expect(content.contentLength).toBeUndefined();
  });

  it('treats an empty body as a valid zero-length document', async () => {
    fetchMock.mockResolvedValue(binaryResponse(200, new Uint8Array()));

    const content = await client.getDocumentContent(DOCUMENT_REFERENCE, ACTOR);

    expect(content.body).toHaveLength(0);
  });

  it('getDocumentText decodes UTF-8 with diacritics using the same download, no second request', async () => {
    const text = 'Straatnaam: Vörböden Wéíde 12, café ☕';
    fetchMock.mockResolvedValue(binaryResponse(200, new TextEncoder().encode(text)));

    const decoded = await client.getDocumentText(DOCUMENT_REFERENCE, ACTOR);

    expect(decoded).toBe(text);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never logs document content, only byteCount', async () => {
    const text = 'gevoelige inhoud die niet gelogd mag worden';
    fetchMock.mockResolvedValue(binaryResponse(200, new TextEncoder().encode(text)));
    const debugSpy = logger.debug as jest.Mock;

    await client.getDocumentContent(DOCUMENT_REFERENCE, ACTOR);

    const loggedText = JSON.stringify(debugSpy.mock.calls);
    expect(loggedText).not.toContain(text);
    expect(loggedText).toContain('byteCount');
  });

  it('rejects a reference that is not a valid URL without a request', async () => {
    await expect(client.getDocumentContent('not-a-url', ACTOR)).rejects.toThrow('valid URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
