import { OpenZaakClient } from '../../../../../shared/clients/open-zaak/OpenZaakClient';
import { CaseSourceLink } from '../../../domain/WoonbehoefteCase';
import {
  ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION, AdditionalEvidenceSourceFailure, AdditionalEvidenceSourceRecord,
} from '../../domain/AdditionalEvidenceSource';
import { loadAdditionalEvidenceCaseDocumentGroups } from '../AdditionalEvidenceCaseDocumentsLoader';

function link(overrides: Partial<CaseSourceLink> = {}): CaseSourceLink {
  return {
    caseReference: 'OF-HOOFD01',
    submissionId: 'uuid-extra-01',
    submissionReference: 'OF-EXTRA01',
    relation: 'ADDITIONAL',
    linkedAt: '2026-09-09T10:32:00.000Z',
    linkedBy: 'medewerker@example.invalid',
    ...overrides,
  };
}

function readySource(overrides: Partial<AdditionalEvidenceSourceRecord> = {}): AdditionalEvidenceSourceRecord {
  return {
    status: 'READY',
    cacheVersion: ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION,
    objectUuid: 'uuid-extra-01',
    submissionId: 'uuid-extra-01',
    reference: 'OF-EXTRA01',
    formName: 'Extra bewijzen stroomaansluiting woningbouw',
    submittedAt: '2026-09-07T17:54:04.702Z',
    originalCaseReference: 'OF-HOOFD01',
    attachments: [],
    cachedAt: '2026-09-07T18:00:00.000Z',
    ...overrides,
  };
}

function failedSource(overrides: Partial<AdditionalEvidenceSourceFailure> = {}): AdditionalEvidenceSourceFailure {
  return {
    status: 'FAILED',
    objectUuid: 'uuid-extra-01',
    reference: 'OF-EXTRA01',
    failureReasonCode: 'CSV_FETCH_ERROR',
    lastAttemptAt: '2026-09-07T18:00:00.000Z',
    ...overrides,
  };
}

function noOpenZaakClient(): OpenZaakClient {
  return { getDocumentMetadata: jest.fn() } as unknown as OpenZaakClient;
}

describe('loadAdditionalEvidenceCaseDocumentGroups', () => {
  it('builds one group per additional link, with the case document downloadHref, not the additional-evidence one', async () => {
    const openZaakClient = { getDocumentMetadata: jest.fn().mockResolvedValue({ bestandsnaam: 'bewijs.pdf', formaat: 'application/pdf' }) } as unknown as OpenZaakClient;
    const source = readySource({
      pdfDocument: { documentId: 'pdf-1', url: 'https://example.invalid/pdf-1', role: 'APPLICATION_PDF' },
      attachments: [{ documentId: 'att-1', url: 'https://example.invalid/att-1', role: 'ATTACHMENT' }],
    });

    const groups = await loadAdditionalEvidenceCaseDocumentGroups(
      openZaakClient, 'OF-HOOFD01', [link()], new Map([['uuid-extra-01', source]]), { principalId: 'medewerker' },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].submissionReference).toBe('OF-EXTRA01');
    expect(groups[0].linkedByLabel).toBe('medewerker@example.invalid');
    expect(groups[0].hasSourceError).toBe(false);
    expect(groups[0].documents.map((d) => d.downloadHref)).toEqual([
      '/woonbehoefte/cases/OF-HOOFD01/documents/pdf-1',
      '/woonbehoefte/cases/OF-HOOFD01/documents/att-1',
    ]);
  });

  it('builds a group per link, supporting two simultaneously linked submissions', async () => {
    const source1 = readySource({ objectUuid: 'uuid-extra-01', submissionId: 'uuid-extra-01' });
    const source2 = readySource({ objectUuid: 'uuid-extra-02', submissionId: 'uuid-extra-02', reference: 'OF-EXTRA02' });

    const groups = await loadAdditionalEvidenceCaseDocumentGroups(
      noOpenZaakClient(), 'OF-HOOFD01',
      [link(), link({ submissionId: 'uuid-extra-02', submissionReference: 'OF-EXTRA02' })],
      new Map([['uuid-extra-01', source1], ['uuid-extra-02', source2]]),
      { principalId: 'medewerker' },
    );

    expect(groups.map((g) => g.submissionReference)).toEqual(['OF-EXTRA01', 'OF-EXTRA02']);
  });

  it('shows a bronwaarschuwing for a FAILED source, but still lists the documents it kept', async () => {
    const openZaakClient = { getDocumentMetadata: jest.fn().mockResolvedValue({ bestandsnaam: 'bewijs.pdf' }) } as unknown as OpenZaakClient;
    const source = failedSource({ attachments: [{ documentId: 'att-1', url: 'https://example.invalid/att-1', role: 'ATTACHMENT' }] });

    const groups = await loadAdditionalEvidenceCaseDocumentGroups(
      openZaakClient, 'OF-HOOFD01', [link()], new Map([['uuid-extra-01', source]]), { principalId: 'medewerker' },
    );

    expect(groups[0].hasSourceError).toBe(true);
    expect(groups[0].sourceErrorMessage).toContain('konden niet volledig worden gelezen');
    expect(groups[0].documents).toHaveLength(1);
    expect(groups[0].hasDocuments).toBe(true);
  });

  it('shows a bronwaarschuwing without any documents when the source is missing entirely', async () => {
    const groups = await loadAdditionalEvidenceCaseDocumentGroups(
      noOpenZaakClient(), 'OF-HOOFD01', [link()], new Map(), { principalId: 'medewerker' },
    );

    expect(groups[0].hasSourceError).toBe(true);
    expect(groups[0].sourceErrorMessage).toContain('nog niet beschikbaar');
    expect(groups[0].documents).toHaveLength(0);
    expect(groups[0].hasDocuments).toBe(false);
  });

  it('falls back to a safe filename when the Open Zaak metadata call fails', async () => {
    const openZaakClient = { getDocumentMetadata: jest.fn().mockRejectedValue(new Error('metadata unavailable')) } as unknown as OpenZaakClient;
    const source = readySource({ pdfDocument: { documentId: 'pdf-1', url: 'https://example.invalid/pdf-1', role: 'APPLICATION_PDF' } });

    const groups = await loadAdditionalEvidenceCaseDocumentGroups(
      openZaakClient, 'OF-HOOFD01', [link()], new Map([['uuid-extra-01', source]]), { principalId: 'medewerker' },
    );

    expect(groups[0].documents[0].filenameLabel).toBe('Extra-bewijzenformulier (PDF)');
  });

  it('returns no groups at all when there are no additional links', async () => {
    const groups = await loadAdditionalEvidenceCaseDocumentGroups(noOpenZaakClient(), 'OF-HOOFD01', [], new Map(), { principalId: 'medewerker' });

    expect(groups).toEqual([]);
  });
});
