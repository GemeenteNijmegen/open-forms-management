import * as fs from 'fs';
import * as path from 'path';
import { ObjectsClient } from '../../../../shared/clients/objects/ObjectsClient';
import { ObjectResource } from '../../../../shared/clients/objects/ObjectsResponse';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { WOONBEHOEFTE_SOURCE_CACHE_VERSION, WoonbehoefteSourceRecord } from '../../domain/WoonbehoefteSource';
import { WOONBEHOEFTE_PRIMARY_FORM_NAME } from '../WoonbehoefteObjectsQuery';
import { WoonbehoefteSourceCacheStore } from '../WoonbehoefteSourceCacheStore';
import { runWoonbehoefteSyncRefresh, WoonbehoefteSyncWorkerDependencies } from '../WoonbehoefteSyncWorkerRunner';

const samplesDir = path.join(__dirname, 'samples');

function fixture(name: string): string {
  return fs.readFileSync(path.join(samplesDir, name), 'utf-8');
}

function objectResource(uuid: string, reference: string, csvUrl: string): ObjectResource {
  return {
    uuid,
    record: { data: { formName: WOONBEHOEFTE_PRIMARY_FORM_NAME, reference, csv: csvUrl, attachments: [] }, registrationAt: '2026-08-01' },
  } as ObjectResource;
}

function cachedRecord(objectUuid: string): WoonbehoefteSourceRecord {
  return {
    status: 'READY',
    cacheVersion: WOONBEHOEFTE_SOURCE_CACHE_VERSION,
    objectUuid,
    submissionId: objectUuid,
    submissionType: 'PRIMARY_APPLICATION',
    reference: 'OF-cached',
    caseReference: 'OF-cached',
    formName: WOONBEHOEFTE_PRIMARY_FORM_NAME,
    registrationAt: '2026-07-01T00:00:00.000Z',
    applicantType: 'UNKNOWN',
    attachments: [],
    cachedAt: '2026-07-01T00:00:00.000Z',
  };
}

function makeDeps() {
  const csvByUrl: Record<string, string> = {
    'csv://new': fixture('woonbehoefte-submission-category-1.csv'),
  };

  const objectsClient = {
    collectObjects: jest.fn().mockResolvedValue([
      objectResource('uuid-cached', 'OF-cached', 'csv://cached'),
      objectResource('uuid-new', 'OF-new', 'csv://new'),
      objectResource('uuid-broken', 'OF-broken', 'csv://broken'),
    ]),
  } as unknown as ObjectsClient;

  const getDocumentText = jest.fn().mockImplementation(async (url: string) => {
    if (url === 'csv://broken') {
      throw new Error('Open Zaak unavailable');
    }
    return csvByUrl[url];
  });
  const openZaakClient = { getDocumentText } as unknown as OpenZaakClient;

  const sourceCacheStore = {
    getState: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'REFRESHING', startedAt: new Date().toISOString() }),
    getItems: jest.fn().mockResolvedValue(new Map([['uuid-cached', cachedRecord('uuid-cached')]])),
    putReady: jest.fn().mockResolvedValue(undefined),
    putFailed: jest.fn().mockResolvedValue(undefined),
    finalizeRefresh: jest.fn().mockResolvedValue(true),
  };

  const caseRepository = {
    createCaseIfMissing: jest.fn().mockResolvedValue(true),
    createPrimarySourceLinkIfMissing: jest.fn().mockResolvedValue('CREATED'),
  };

  const deps: WoonbehoefteSyncWorkerDependencies = {
    objectsClient,
    openZaakClient,
    sourceCacheStore: sourceCacheStore as unknown as WoonbehoefteSourceCacheStore,
    caseRepository: caseRepository as unknown as WoonbehoefteCaseRepository,
  };

  return { deps, sourceCacheStore, caseRepository, getDocumentText };
}

describe('runWoonbehoefteSyncRefresh', () => {
  it('skips the already-cached UUID, caches the new one, marks the broken one FAILED, and finishes READY_WITH_ERRORS', async () => {
    const { deps, sourceCacheStore, getDocumentText } = makeDeps();

    await runWoonbehoefteSyncRefresh('run-1', deps, () => false, 'trigger-1');

    expect(getDocumentText.mock.calls.map((call: unknown[]) => call[0])).toEqual(expect.arrayContaining(['csv://new', 'csv://broken']));
    expect(getDocumentText.mock.calls.map((call: unknown[]) => call[0])).not.toContain('csv://cached');
    expect(sourceCacheStore.putReady).toHaveBeenCalledWith(expect.objectContaining({ objectUuid: 'uuid-new', status: 'READY', caseReference: 'OF-new' }));
    expect(sourceCacheStore.putFailed).toHaveBeenCalledWith(expect.objectContaining({ objectUuid: 'uuid-broken', status: 'FAILED' }));
    expect(sourceCacheStore.finalizeRefresh).toHaveBeenCalledWith('run-1', 'READY_WITH_ERRORS', expect.any(Date), { failedCount: 1 });
  });

  it('keeps a FAILED marker\'s PDF/attachments downloadable when only the CSV fetch failed, without leaking contact data or the CSV itself', async () => {
    const objectsClient = {
      collectObjects: jest.fn().mockResolvedValue([{
        uuid: 'uuid-broken',
        record: {
          data: {
            formName: WOONBEHOEFTE_PRIMARY_FORM_NAME,
            reference: 'OF-broken',
            csv: 'csv://broken',
            pdf: 'https://open-zaak.example/pdf-1',
            attachments: ['https://open-zaak.example/att-1'],
          },
          registrationAt: '2026-08-01',
        },
      }] as unknown as ObjectResource[]),
    } as unknown as ObjectsClient;
    const openZaakClient = { getDocumentText: jest.fn().mockRejectedValue(new Error('Open Zaak unavailable')) } as unknown as OpenZaakClient;
    const sourceCacheStore = {
      getState: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'REFRESHING', startedAt: new Date().toISOString() }),
      getItems: jest.fn().mockResolvedValue(new Map()),
      putReady: jest.fn().mockResolvedValue(undefined),
      putFailed: jest.fn().mockResolvedValue(undefined),
      finalizeRefresh: jest.fn().mockResolvedValue(true),
    };
    const caseRepository = { createCaseIfMissing: jest.fn().mockResolvedValue(true), createPrimarySourceLinkIfMissing: jest.fn().mockResolvedValue('CREATED') };
    const deps: WoonbehoefteSyncWorkerDependencies = {
      objectsClient,
      openZaakClient,
      sourceCacheStore: sourceCacheStore as unknown as WoonbehoefteSourceCacheStore,
      caseRepository: caseRepository as unknown as WoonbehoefteCaseRepository,
    };

    await runWoonbehoefteSyncRefresh('run-1', deps, () => false, 'trigger-1');

    const marker = sourceCacheStore.putFailed.mock.calls[0][0];
    expect(marker).toMatchObject({
      status: 'FAILED',
      pdfDocument: { documentId: 'pdf-1', url: 'https://open-zaak.example/pdf-1', role: 'APPLICATION_PDF' },
      attachments: [{ documentId: 'att-1', url: 'https://open-zaak.example/att-1', role: 'ATTACHMENT' }],
    });
    expect(marker).not.toHaveProperty('csvDocument');
    expect(marker).not.toHaveProperty('contactName');
    expect(marker).not.toHaveProperty('contactEmail');
    expect(marker).not.toHaveProperty('contactPhone');
  });

  it('initializes a case and primary source-link for every READY record, cached and freshly fetched alike', async () => {
    const { deps, caseRepository } = makeDeps();

    await runWoonbehoefteSyncRefresh('run-1', deps, () => false, 'trigger-1');

    expect(caseRepository.createCaseIfMissing).toHaveBeenCalledWith('OF-cached', 'woonbehoefte-sync-worker', expect.any(Date));
    expect(caseRepository.createCaseIfMissing).toHaveBeenCalledWith('OF-new', 'woonbehoefte-sync-worker', expect.any(Date));
    expect(caseRepository.createPrimarySourceLinkIfMissing).toHaveBeenCalledWith('OF-new', 'uuid-new', 'OF-new', expect.any(Date));
  });

  it('still creates a minimal case for a submission whose CSV download failed, so it never disappears from the werkvoorraad', async () => {
    const { deps, caseRepository } = makeDeps();

    await runWoonbehoefteSyncRefresh('run-1', deps, () => false, 'trigger-1');

    expect(caseRepository.createCaseIfMissing).toHaveBeenCalledWith('OF-broken', 'woonbehoefte-sync-worker', expect.any(Date));
    expect(caseRepository.createPrimarySourceLinkIfMissing).toHaveBeenCalledWith('OF-broken', 'uuid-broken', 'OF-broken', expect.any(Date));
  });

  it('still creates a minimal case for a submission whose CSV content failed to parse', async () => {
    const { deps, caseRepository } = makeDeps();
    deps.objectsClient = {
      collectObjects: jest.fn().mockResolvedValue([objectResource('uuid-corrupt', 'OF-corrupt', 'csv://corrupt')]),
    } as unknown as ObjectsClient;
    (deps.openZaakClient.getDocumentText as jest.Mock).mockImplementation(async (url: string) => (
      url === 'csv://corrupt' ? 'not,a,valid,woonbehoefte,csv\n1,2,3,4,5\n' : ''
    ));
    (deps.sourceCacheStore.getItems as jest.Mock).mockResolvedValue(new Map());

    await runWoonbehoefteSyncRefresh('run-1', deps, () => false, 'trigger-1');

    expect(caseRepository.createCaseIfMissing).toHaveBeenCalledWith('OF-corrupt', 'woonbehoefte-sync-worker', expect.any(Date));
    expect(caseRepository.createPrimarySourceLinkIfMissing).toHaveBeenCalledWith('OF-corrupt', 'uuid-corrupt', 'OF-corrupt', expect.any(Date));
  });

  it('logs a conflict but does not throw when a primary source link already points to a different submission', async () => {
    const { deps, caseRepository } = makeDeps();
    caseRepository.createPrimarySourceLinkIfMissing.mockResolvedValue('CONFLICT');

    await expect(runWoonbehoefteSyncRefresh('run-1', deps, () => false, 'trigger-1')).resolves.toBeUndefined();
  });

  it('does nothing when the runId is no longer the active refresh (superseded by a newer claim)', async () => {
    const { deps, sourceCacheStore, getDocumentText } = makeDeps();
    sourceCacheStore.getState.mockResolvedValue({ runId: 'run-2', status: 'REFRESHING', startedAt: new Date().toISOString() });

    await runWoonbehoefteSyncRefresh('run-1', deps, () => false, 'trigger-1');

    expect(getDocumentText).not.toHaveBeenCalled();
    expect(sourceCacheStore.finalizeRefresh).not.toHaveBeenCalled();
  });

  it('makes no Open Zaak calls at all on a warm run where every object is already cached on the current version', async () => {
    const { deps, sourceCacheStore, getDocumentText } = makeDeps();
    sourceCacheStore.getItems.mockResolvedValue(new Map([
      ['uuid-cached', cachedRecord('uuid-cached')],
      ['uuid-new', cachedRecord('uuid-new')],
      ['uuid-broken', cachedRecord('uuid-broken')],
    ]));

    await runWoonbehoefteSyncRefresh('run-1', deps, () => false, 'trigger-1');

    expect(getDocumentText).not.toHaveBeenCalled();
    expect(sourceCacheStore.finalizeRefresh).toHaveBeenCalledWith('run-1', 'READY', expect.any(Date), {});
  });

  it('reaches its time cutoff before the CSV phase and finalizes as FAILED with a technical reason, not READY_WITH_ERRORS', async () => {
    const { deps, sourceCacheStore, getDocumentText } = makeDeps();

    await runWoonbehoefteSyncRefresh('run-1', deps, () => true, 'trigger-1');

    expect(getDocumentText).not.toHaveBeenCalled();
    expect(sourceCacheStore.finalizeRefresh).toHaveBeenCalledWith('run-1', 'FAILED', expect.any(Date), { failureReason: 'TIME_LIMIT_REACHED' });
  });

  it('never runs case initialization once the cutoff is reached right after the CSV phase', async () => {
    const { deps, sourceCacheStore, caseRepository } = makeDeps();
    let cutoffChecks = 0;
    const isPastCutoff = () => {
      cutoffChecks += 1;
      return cutoffChecks > 1;
    };

    await runWoonbehoefteSyncRefresh('run-1', deps, isPastCutoff, 'trigger-1');

    expect(sourceCacheStore.putReady).toHaveBeenCalledWith(expect.objectContaining({ objectUuid: 'uuid-new' }));
    expect(caseRepository.createCaseIfMissing).not.toHaveBeenCalled();
    expect(sourceCacheStore.finalizeRefresh).toHaveBeenCalledWith('run-1', 'FAILED', expect.any(Date), { failureReason: 'TIME_LIMIT_REACHED' });
  });

  it('rejects an object whose formName does not match the primary Woonbehoefte form, marking it FAILED', async () => {
    const objectsClient = {
      collectObjects: jest.fn().mockResolvedValue([
        { uuid: 'uuid-wrong-form', record: { data: { formName: 'Ander formulier', reference: 'OF-wrong', csv: 'csv://wrong' } } } as ObjectResource,
      ]),
    } as unknown as ObjectsClient;
    const openZaakClient = { getDocumentText: jest.fn() } as unknown as OpenZaakClient;
    const sourceCacheStore = {
      getState: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'REFRESHING', startedAt: new Date().toISOString() }),
      getItems: jest.fn().mockResolvedValue(new Map()),
      putReady: jest.fn().mockResolvedValue(undefined),
      putFailed: jest.fn().mockResolvedValue(undefined),
      finalizeRefresh: jest.fn().mockResolvedValue(true),
    };
    const caseRepository = { createCaseIfMissing: jest.fn(), createPrimarySourceLinkIfMissing: jest.fn() };
    const deps: WoonbehoefteSyncWorkerDependencies = {
      objectsClient,
      openZaakClient,
      sourceCacheStore: sourceCacheStore as unknown as WoonbehoefteSourceCacheStore,
      caseRepository: caseRepository as unknown as WoonbehoefteCaseRepository,
    };

    await runWoonbehoefteSyncRefresh('run-1', deps, () => false, 'trigger-1');

    expect(openZaakClient.getDocumentText).not.toHaveBeenCalled();
    expect(sourceCacheStore.putFailed).toHaveBeenCalledWith(expect.objectContaining({ objectUuid: 'uuid-wrong-form', status: 'FAILED' }));
    expect(sourceCacheStore.finalizeRefresh).toHaveBeenCalledWith('run-1', 'READY_WITH_ERRORS', expect.any(Date), { failedCount: 1 });
  });
});
