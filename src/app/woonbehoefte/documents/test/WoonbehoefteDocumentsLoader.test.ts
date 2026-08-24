import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { WoonbehoefteSourceRecord } from '../../domain/WoonbehoefteSource';
import { loadWoonbehoefteDocuments } from '../WoonbehoefteDocumentsLoader';

function makeSource(overrides: Partial<WoonbehoefteSourceRecord> = {}): WoonbehoefteSourceRecord {
  return {
    status: 'READY',
    cacheVersion: 1,
    objectUuid: 'uuid-1',
    submissionId: 'uuid-1',
    submissionType: 'PRIMARY_APPLICATION',
    reference: 'OF-1',
    caseReference: 'OF-1',
    formName: 'Aanmelden stroomaansluiting woningbouw',
    registrationAt: '2026-08-01T10:00:00.000Z',
    applicantType: 'UNKNOWN',
    attachments: [],
    cachedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('loadWoonbehoefteDocuments', () => {
  it('never includes the CSV: only pdf/attachments become downloadable documents', async () => {
    const source = makeSource({
      csvDocument: { documentId: 'csv-1', url: 'https://example.invalid/csv-1', role: 'CSV' },
      pdfDocument: { documentId: 'pdf-1', url: 'https://example.invalid/pdf-1', role: 'APPLICATION_PDF' },
    });
    const getDocumentMetadata = jest.fn().mockResolvedValue({ bestandsnaam: 'aanvraag.pdf', formaat: 'application/pdf', bestandsomvang: 2048 });
    const client = { getDocumentMetadata } as unknown as OpenZaakClient;

    const rows = await loadWoonbehoefteDocuments(client, source, 'OF-1', { principalId: 'medewerker' });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ documentId: 'pdf-1', filenameLabel: 'aanvraag.pdf', formatLabel: 'application/pdf', sizeLabel: '2 KB', isApplicationPdf: true });
  });

  it('falls back to a safe attachment name and keeps the page usable when metadata fails for one document', async () => {
    const source = makeSource({
      attachments: [
        { documentId: 'att-1', url: 'https://example.invalid/att-1', role: 'ATTACHMENT' },
        { documentId: 'att-2', url: 'https://example.invalid/att-2', role: 'ATTACHMENT' },
      ],
    });
    const getDocumentMetadata = jest.fn()
      .mockResolvedValueOnce({ bestandsnaam: 'foto1.jpg' })
      .mockRejectedValueOnce(new Error('Open Zaak unavailable'));
    const client = { getDocumentMetadata } as unknown as OpenZaakClient;

    const rows = await loadWoonbehoefteDocuments(client, source, 'OF-1', { principalId: 'medewerker' });

    expect(rows[0].filenameLabel).toBe('foto1.jpg');
    expect(rows[1].filenameLabel).toBe('Bijlage 2');
    expect(rows[1].downloadHref).toBe('/woonbehoefte/cases/OF-1/documents/att-2');
  });
});
