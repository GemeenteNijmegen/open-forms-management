import { AdditionalEvidenceSourceItem } from '../../../additional-evidence/domain/AdditionalEvidenceSource';
import { CaseSourceLink } from '../../../domain/WoonbehoefteCase';
import { SourceDocumentReference } from '../../../domain/WoonbehoefteSource';
import { buildAttachmentFilenamesOutcome, collectCaseAttachmentReferences } from '../WoonbehoefteReportAttachments';

function ref(documentId: string, role: SourceDocumentReference['role'] = 'ATTACHMENT'): SourceDocumentReference {
  return { documentId, url: `https://open-zaak.example.invalid/${documentId}`, role };
}

function additionalLink(objectUuid: string, linkedAt: string): CaseSourceLink {
  return { caseReference: 'OF-1', submissionId: objectUuid, submissionReference: `EB-${objectUuid}`, relation: 'ADDITIONAL', linkedAt };
}

function additionalSource(objectUuid: string, attachments: SourceDocumentReference[]): AdditionalEvidenceSourceItem {
  return {
    status: 'READY',
    cacheVersion: 1,
    objectUuid,
    submissionId: objectUuid,
    reference: `EB-${objectUuid}`,
    formName: 'Extra bewijzen',
    submittedAt: '2026-08-22T00:00:00.000Z',
    originalCaseReference: 'OF-1',
    attachments,
    cachedAt: '2026-08-22T00:00:00.000Z',
  };
}

describe('collectCaseAttachmentReferences', () => {
  it('includes only the primary source\'s ATTACHMENT-role documents, excluding CSV/APPLICATION_PDF', () => {
    const primaryAttachments = [ref('doc-csv', 'CSV'), ref('doc-pdf', 'APPLICATION_PDF'), ref('doc-1'), ref('doc-2')];

    const result = collectCaseAttachmentReferences(primaryAttachments, [], new Map());

    expect(result.references.map((r) => r.documentId)).toEqual(['doc-1', 'doc-2']);
    expect(result.missingAdditionalSourceCount).toBe(0);
  });

  it('includes a linked Additional Evidence source\'s ATTACHMENT-role documents, after the primary ones', () => {
    const primaryAttachments = [ref('doc-primary')];
    const sourceLinks = [additionalLink('uuid-1', '2026-08-22T00:00:00.000Z')];
    const additionalSourcesByObjectUuid = new Map([['uuid-1', additionalSource('uuid-1', [ref('doc-additional')])]]);

    const result = collectCaseAttachmentReferences(primaryAttachments, sourceLinks, additionalSourcesByObjectUuid);

    expect(result.references.map((r) => r.documentId)).toEqual(['doc-primary', 'doc-additional']);
  });

  it('orders multiple Additional Evidence links by linkedAt ascending (oldest link first)', () => {
    const sourceLinks = [additionalLink('uuid-newer', '2026-08-25T00:00:00.000Z'), additionalLink('uuid-older', '2026-08-20T00:00:00.000Z')];
    const additionalSourcesByObjectUuid = new Map([
      ['uuid-newer', additionalSource('uuid-newer', [ref('doc-newer')])],
      ['uuid-older', additionalSource('uuid-older', [ref('doc-older')])],
    ]);

    const result = collectCaseAttachmentReferences(undefined, sourceLinks, additionalSourcesByObjectUuid);

    expect(result.references.map((r) => r.documentId)).toEqual(['doc-older', 'doc-newer']);
  });

  it('counts a linked Additional Evidence source that is missing from the cache as a warning, not a failure', () => {
    const sourceLinks = [additionalLink('uuid-missing', '2026-08-22T00:00:00.000Z')];

    const result = collectCaseAttachmentReferences([ref('doc-primary')], sourceLinks, new Map());

    expect(result.references.map((r) => r.documentId)).toEqual(['doc-primary']);
    expect(result.missingAdditionalSourceCount).toBe(1);
  });

  it('counts a linked Additional Evidence source that is a FAILED marker as a warning too', () => {
    const sourceLinks = [additionalLink('uuid-failed', '2026-08-22T00:00:00.000Z')];
    const additionalSourcesByObjectUuid = new Map<string, AdditionalEvidenceSourceItem>([
      ['uuid-failed', { status: 'FAILED', objectUuid: 'uuid-failed', failureReasonCode: 'OBJECT_READ_ERROR', lastAttemptAt: '2026-08-22T00:00:00.000Z' }],
    ]);

    const result = collectCaseAttachmentReferences(undefined, sourceLinks, additionalSourcesByObjectUuid);

    expect(result.references).toHaveLength(0);
    expect(result.missingAdditionalSourceCount).toBe(1);
  });

  it('deduplicates the same documentId when it is unexpectedly linked twice', () => {
    const primaryAttachments = [ref('doc-shared')];
    const sourceLinks = [additionalLink('uuid-1', '2026-08-22T00:00:00.000Z')];
    const additionalSourcesByObjectUuid = new Map([['uuid-1', additionalSource('uuid-1', [ref('doc-shared')])]]);

    const result = collectCaseAttachmentReferences(primaryAttachments, sourceLinks, additionalSourcesByObjectUuid);

    expect(result.references.map((r) => r.documentId)).toEqual(['doc-shared']);
  });

  it('ignores a PRIMARY source link entirely, since primary attachments already come from the joined source', () => {
    const sourceLinks: CaseSourceLink[] = [
      { caseReference: 'OF-1', submissionId: 'uuid-primary', submissionReference: 'OF-1', relation: 'PRIMARY', linkedAt: '2026-08-01T00:00:00.000Z' },
    ];

    const result = collectCaseAttachmentReferences([ref('doc-primary')], sourceLinks, new Map());

    expect(result.references.map((r) => r.documentId)).toEqual(['doc-primary']);
    expect(result.missingAdditionalSourceCount).toBe(0);
  });
});

describe('buildAttachmentFilenamesOutcome', () => {
  it('joins resolved filenames one per line, in reference order', () => {
    const outcome = buildAttachmentFilenamesOutcome(
      { references: [ref('doc-1'), ref('doc-2')], missingAdditionalSourceCount: 0 },
      new Map([['doc-1', 'bijlage-een.pdf'], ['doc-2', 'bijlage-twee.pdf']]),
    );

    expect(outcome.filenamesText).toBe('bijlage-een.pdf\nbijlage-twee.pdf');
    expect(outcome.warning).toBeUndefined();
  });

  it('leaves filenamesText empty and no warning when there are no attachments at all', () => {
    const outcome = buildAttachmentFilenamesOutcome({ references: [], missingAdditionalSourceCount: 0 }, new Map());

    expect(outcome.filenamesText).toBe('');
    expect(outcome.warning).toBeUndefined();
  });

  it('warns (singular) when exactly one filename could not be resolved, and omits it from the cell', () => {
    const outcome = buildAttachmentFilenamesOutcome(
      { references: [ref('doc-1'), ref('doc-2')], missingAdditionalSourceCount: 0 },
      new Map([['doc-1', 'bijlage-een.pdf']]),
    );

    expect(outcome.filenamesText).toBe('bijlage-een.pdf');
    expect(outcome.warning).toBe('Bestandsnaam van 1 bijlage kon niet worden geladen.');
  });

  it('warns (plural) when multiple filenames could not be resolved', () => {
    const outcome = buildAttachmentFilenamesOutcome(
      { references: [ref('doc-1'), ref('doc-2')], missingAdditionalSourceCount: 0 },
      new Map(),
    );

    expect(outcome.warning).toBe('Bestandsnamen van 2 bijlagen konden niet worden geladen.');
  });

  it('combines an unresolved-filename warning with a missing-additional-source warning on separate lines', () => {
    const outcome = buildAttachmentFilenamesOutcome(
      { references: [ref('doc-1')], missingAdditionalSourceCount: 1 },
      new Map(),
    );

    expect(outcome.warning?.split('\n')).toHaveLength(2);
    expect(outcome.warning).toContain('Bestandsnaam van 1 bijlage kon niet worden geladen.');
    expect(outcome.warning).toContain('Gekoppelde extra-bewijzenbron kon niet worden gelezen.');
  });
});
