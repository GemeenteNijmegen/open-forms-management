import { OpenZaakClient } from '../../../../../shared/clients/open-zaak/OpenZaakClient';
import { SourceDocumentReference } from '../../../domain/WoonbehoefteSource';
import { fetchWoonbehoefteAttachmentFilenames } from '../fetchWoonbehoefteAttachmentFilenames';

function ref(documentId: string): SourceDocumentReference {
  return { documentId, url: `https://open-zaak.example.invalid/${documentId}`, role: 'ATTACHMENT' };
}

describe('fetchWoonbehoefteAttachmentFilenames', () => {
  it('resolves bestandsnaam for every unique attachment', async () => {
    const getDocumentMetadata = jest.fn().mockImplementation(async (url: string) => ({ bestandsnaam: `${url.split('/').pop()}.pdf` }));
    const client = { getDocumentMetadata } as unknown as OpenZaakClient;

    const result = await fetchWoonbehoefteAttachmentFilenames(client, [ref('doc-1'), ref('doc-2')], { principalId: 'woonbehoefte-excel-worker' });

    expect(result.get('doc-1')).toBe('doc-1.pdf');
    expect(result.get('doc-2')).toBe('doc-2.pdf');
    expect(getDocumentMetadata).toHaveBeenCalledTimes(2);
  });

  it('deduplicates the same documentId before fetching, fetching metadata only once', async () => {
    const getDocumentMetadata = jest.fn().mockResolvedValue({ bestandsnaam: 'bijlage.pdf' });
    const client = { getDocumentMetadata } as unknown as OpenZaakClient;

    const result = await fetchWoonbehoefteAttachmentFilenames(client, [ref('doc-1'), ref('doc-1')], { principalId: 'woonbehoefte-excel-worker' });

    expect(getDocumentMetadata).toHaveBeenCalledTimes(1);
    expect(result.get('doc-1')).toBe('bijlage.pdf');
  });

  it('leaves a documentId out of the result when the metadata fetch fails, without throwing', async () => {
    const getDocumentMetadata = jest.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('doc-1')) {
        throw new Error('Open Zaak unavailable');
      }
      return { bestandsnaam: 'bijlage.pdf' };
    });
    const client = { getDocumentMetadata } as unknown as OpenZaakClient;

    const result = await fetchWoonbehoefteAttachmentFilenames(client, [ref('doc-1'), ref('doc-2')], { principalId: 'woonbehoefte-excel-worker' });

    expect(result.has('doc-1')).toBe(false);
    expect(result.get('doc-2')).toBe('bijlage.pdf');
  });

  it('leaves a documentId out of the result when metadata has no bestandsnaam', async () => {
    const getDocumentMetadata = jest.fn().mockResolvedValue({});
    const client = { getDocumentMetadata } as unknown as OpenZaakClient;

    const result = await fetchWoonbehoefteAttachmentFilenames(client, [ref('doc-1')], { principalId: 'woonbehoefte-excel-worker' });

    expect(result.has('doc-1')).toBe(false);
  });

  it('respects a small fixed concurrency, never firing every request at once', async () => {
    const references = Array.from({ length: 10 }, (_, i) => ref(`doc-${i}`));
    let concurrentCalls = 0;
    let maxConcurrentCalls = 0;
    const getDocumentMetadata = jest.fn().mockImplementation(async () => {
      concurrentCalls += 1;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
      await new Promise((resolve) => { setTimeout(resolve, 1); });
      concurrentCalls -= 1;
      return { bestandsnaam: 'bijlage.pdf' };
    });
    const client = { getDocumentMetadata } as unknown as OpenZaakClient;

    await fetchWoonbehoefteAttachmentFilenames(client, references, { principalId: 'woonbehoefte-excel-worker' });

    expect(maxConcurrentCalls).toBeLessThanOrEqual(4);
    expect(getDocumentMetadata).toHaveBeenCalledTimes(10);
  });
});
