import { AdditionalEvidenceSourceCacheStore } from '../../../additional-evidence/source/AdditionalEvidenceSourceCacheStore';
import { WoonbehoefteCaseRepository } from '../../../cases/WoonbehoefteCaseRepository';
import { WoonbehoefteCase } from '../../../domain/WoonbehoefteCase';
import { WoonbehoefteSourceRecord } from '../../../domain/WoonbehoefteSource';
import { WoonbehoefteCaseWithSource } from '../../../overview/WoonbehoefteOverviewViewModel';
import { collectWoonbehoefteAttachmentReferences } from '../collectWoonbehoefteAttachmentReferences';

function woonbehoefteCase(caseReference: string): WoonbehoefteCase {
  return {
    caseReference,
    status: 'NEW',
    statusChangedAt: '2026-08-01T00:00:00.000Z',
    assessment: {},
    check: { requested: false },
    version: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    createdBy: 'woonbehoefte-sync-worker',
    updatedAt: '2026-08-01T00:00:00.000Z',
    updatedBy: 'woonbehoefte-sync-worker',
  };
}

function source(caseReference: string, overrides: Partial<WoonbehoefteSourceRecord> = {}): WoonbehoefteSourceRecord {
  return {
    status: 'READY',
    cacheVersion: 1,
    objectUuid: `uuid-${caseReference}`,
    submissionId: `uuid-${caseReference}`,
    submissionType: 'PRIMARY_APPLICATION',
    reference: caseReference,
    caseReference,
    formName: 'Aanmelden stroomaansluiting woningbouw',
    registrationAt: '2026-08-20T10:15:00.000Z',
    applicantType: 'INDIVIDUAL',
    attachments: [],
    cachedAt: '2026-08-20T10:15:00.000Z',
    ...overrides,
  };
}

describe('collectWoonbehoefteAttachmentReferences', () => {
  it('reads only SOURCE# links per case, never notes/activities, through getSourceLinks', async () => {
    const entries: WoonbehoefteCaseWithSource[] = [{ woonbehoefteCase: woonbehoefteCase('OF-1'), source: source('OF-1') }];
    const getSourceLinks = jest.fn().mockResolvedValue([]);
    const caseRepository = { getSourceLinks } as unknown as WoonbehoefteCaseRepository;
    const getItems = jest.fn().mockResolvedValue(new Map());
    const additionalSourceCacheStore = { getItems } as unknown as AdditionalEvidenceSourceCacheStore;

    await collectWoonbehoefteAttachmentReferences(caseRepository, additionalSourceCacheStore, entries);

    expect(getSourceLinks).toHaveBeenCalledWith('OF-1');
  });

  it('resolves every ADDITIONAL link\'s objectUuid in one batched getItems call, never one per case', async () => {
    const entries: WoonbehoefteCaseWithSource[] = [
      { woonbehoefteCase: woonbehoefteCase('OF-1'), source: source('OF-1') },
      { woonbehoefteCase: woonbehoefteCase('OF-2'), source: source('OF-2') },
    ];
    const getSourceLinks = jest.fn().mockImplementation(async (caseReference: string) => [
      { caseReference, submissionId: `additional-${caseReference}`, submissionReference: `EB-${caseReference}`, relation: 'ADDITIONAL', linkedAt: '2026-08-22T00:00:00.000Z' },
    ]);
    const caseRepository = { getSourceLinks } as unknown as WoonbehoefteCaseRepository;
    const getItems = jest.fn().mockResolvedValue(new Map());
    const additionalSourceCacheStore = { getItems } as unknown as AdditionalEvidenceSourceCacheStore;

    await collectWoonbehoefteAttachmentReferences(caseRepository, additionalSourceCacheStore, entries);

    expect(getItems).toHaveBeenCalledTimes(1);
    expect(getItems).toHaveBeenCalledWith(expect.arrayContaining(['additional-OF-1', 'additional-OF-2']));
  });

  it('never calls getItems when no case has an ADDITIONAL link', async () => {
    const entries: WoonbehoefteCaseWithSource[] = [{ woonbehoefteCase: woonbehoefteCase('OF-1'), source: source('OF-1') }];
    const caseRepository = { getSourceLinks: jest.fn().mockResolvedValue([]) } as unknown as WoonbehoefteCaseRepository;
    const getItems = jest.fn();
    const additionalSourceCacheStore = { getItems } as unknown as AdditionalEvidenceSourceCacheStore;

    await collectWoonbehoefteAttachmentReferences(caseRepository, additionalSourceCacheStore, entries);

    expect(getItems).not.toHaveBeenCalled();
  });

  it('respects a small fixed concurrency for the per-case source-link reads', async () => {
    const entries: WoonbehoefteCaseWithSource[] = Array.from({ length: 10 }, (_, i) => (
      { woonbehoefteCase: woonbehoefteCase(`OF-${i}`), source: source(`OF-${i}`) }
    ));
    let concurrentCalls = 0;
    let maxConcurrentCalls = 0;
    const getSourceLinks = jest.fn().mockImplementation(async () => {
      concurrentCalls += 1;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
      await new Promise((resolve) => { setTimeout(resolve, 1); });
      concurrentCalls -= 1;
      return [];
    });
    const caseRepository = { getSourceLinks } as unknown as WoonbehoefteCaseRepository;
    const additionalSourceCacheStore = { getItems: jest.fn() } as unknown as AdditionalEvidenceSourceCacheStore;

    await collectWoonbehoefteAttachmentReferences(caseRepository, additionalSourceCacheStore, entries);

    expect(maxConcurrentCalls).toBeLessThanOrEqual(4);
    expect(getSourceLinks).toHaveBeenCalledTimes(10);
  });

  it('returns one CaseAttachmentReferences entry per case, keyed by caseReference', async () => {
    const entries: WoonbehoefteCaseWithSource[] = [
      { woonbehoefteCase: woonbehoefteCase('OF-1'), source: source('OF-1', { attachments: [{ documentId: 'doc-1', url: 'https://open-zaak.example.invalid/doc-1', role: 'ATTACHMENT' }] }) },
      { woonbehoefteCase: woonbehoefteCase('OF-2'), source: source('OF-2') },
    ];
    const caseRepository = { getSourceLinks: jest.fn().mockResolvedValue([]) } as unknown as WoonbehoefteCaseRepository;
    const additionalSourceCacheStore = { getItems: jest.fn().mockResolvedValue(new Map()) } as unknown as AdditionalEvidenceSourceCacheStore;

    const result = await collectWoonbehoefteAttachmentReferences(caseRepository, additionalSourceCacheStore, entries);

    expect(result.get('OF-1')?.references.map((r) => r.documentId)).toEqual(['doc-1']);
    expect(result.get('OF-2')?.references).toEqual([]);
  });
});
