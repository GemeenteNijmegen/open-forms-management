import * as fs from 'fs';
import * as path from 'path';
import { ObjectsClient } from '../../../../../shared/clients/objects/ObjectsClient';
import { ObjectResource } from '../../../../../shared/clients/objects/ObjectsResponse';
import { OpenZaakClient } from '../../../../../shared/clients/open-zaak/OpenZaakClient';
import { ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION, AdditionalEvidenceSourceRecord } from '../../domain/AdditionalEvidenceSource';
import { AdditionalEvidenceRepository } from '../../persistence/AdditionalEvidenceRepository';
import { ADDITIONAL_EVIDENCE_FORM_NAME } from '../AdditionalEvidenceObjectsQuery';
import { AdditionalEvidenceSourceCacheStore } from '../AdditionalEvidenceSourceCacheStore';
import { runAdditionalEvidenceSyncRefresh, AdditionalEvidenceSyncWorkerDependencies } from '../AdditionalEvidenceSyncWorkerRunner';

const samplesDir = path.join(__dirname, 'samples');

function fixture(name: string): string {
  return fs.readFileSync(path.join(samplesDir, name), 'utf-8');
}

function objectResource(uuid: string, reference: string, csvUrl: string): ObjectResource {
  return {
    uuid,
    record: { data: { formName: ADDITIONAL_EVIDENCE_FORM_NAME, reference, csv: csvUrl, attachments: [] } },
  } as ObjectResource;
}

function cachedRecord(objectUuid: string): AdditionalEvidenceSourceRecord {
  return {
    status: 'READY',
    cacheVersion: ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION,
    objectUuid,
    submissionId: objectUuid,
    reference: 'OF-EXTRA-cached',
    formName: ADDITIONAL_EVIDENCE_FORM_NAME,
    submittedAt: '2026-07-01T00:00:00.000Z',
    originalCaseReference: 'OF-HOOFD-cached',
    attachments: [],
    cachedAt: '2026-07-01T00:00:00.000Z',
  };
}

function makeDeps() {
  const csvByUrl: Record<string, string> = {
    'csv://new': fixture('additional-evidence-001.csv'),
  };

  const objectsClient = {
    collectObjects: jest.fn().mockResolvedValue([
      objectResource('uuid-cached', 'OF-EXTRA-cached', 'csv://cached'),
      objectResource('uuid-new', 'OF-EXTRA-new', 'csv://new'),
      objectResource('uuid-broken', 'OF-EXTRA-broken', 'csv://broken'),
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

  const repository = { createWorkItemIfMissing: jest.fn().mockResolvedValue(true) };

  const deps: AdditionalEvidenceSyncWorkerDependencies = {
    objectsClient,
    openZaakClient,
    sourceCacheStore: sourceCacheStore as unknown as AdditionalEvidenceSourceCacheStore,
    repository: repository as unknown as AdditionalEvidenceRepository,
  };

  return { deps, sourceCacheStore, repository, getDocumentText };
}

describe('runAdditionalEvidenceSyncRefresh', () => {
  it('skips the already-cached UUID, caches the new one, marks the broken one FAILED, and finishes READY_WITH_ERRORS', async () => {
    const { deps, sourceCacheStore, getDocumentText } = makeDeps();

    await runAdditionalEvidenceSyncRefresh('run-1', deps, () => false, 'trigger-1');

    expect(getDocumentText.mock.calls.map((call: unknown[]) => call[0])).toEqual(expect.arrayContaining(['csv://new', 'csv://broken']));
    expect(getDocumentText.mock.calls.map((call: unknown[]) => call[0])).not.toContain('csv://cached');
    expect(sourceCacheStore.putReady).toHaveBeenCalledWith(expect.objectContaining({
      objectUuid: 'uuid-new', status: 'READY', originalCaseReference: 'OF-HOOFD01',
    }));
    expect(sourceCacheStore.putFailed).toHaveBeenCalledWith(expect.objectContaining({ objectUuid: 'uuid-broken', status: 'FAILED' }));
    expect(sourceCacheStore.finalizeRefresh).toHaveBeenCalledWith('run-1', 'READY_WITH_ERRORS', expect.any(Date), { failedCount: 1 });
  });

  it('keeps a FAILED marker\'s PDF/attachments downloadable when only the CSV fetch failed, without leaking contact data or the CSV itself', async () => {
    const objectsClient = {
      collectObjects: jest.fn().mockResolvedValue([{
        uuid: 'uuid-broken',
        record: {
          data: {
            formName: ADDITIONAL_EVIDENCE_FORM_NAME,
            reference: 'OF-EXTRA-broken',
            csv: 'csv://broken',
            pdf: 'https://open-zaak.example/pdf-1',
            attachments: ['https://open-zaak.example/att-1'],
          },
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
    const repository = { createWorkItemIfMissing: jest.fn().mockResolvedValue(true) };
    const deps: AdditionalEvidenceSyncWorkerDependencies = {
      objectsClient,
      openZaakClient,
      sourceCacheStore: sourceCacheStore as unknown as AdditionalEvidenceSourceCacheStore,
      repository: repository as unknown as AdditionalEvidenceRepository,
    };

    await runAdditionalEvidenceSyncRefresh('run-1', deps, () => false, 'trigger-1');

    const marker = sourceCacheStore.putFailed.mock.calls[0][0];
    expect(marker).toMatchObject({
      status: 'FAILED',
      pdfDocument: { documentId: 'pdf-1', url: 'https://open-zaak.example/pdf-1', role: 'APPLICATION_PDF' },
      attachments: [{ documentId: 'att-1', url: 'https://open-zaak.example/att-1', role: 'ATTACHMENT' }],
    });
    expect(marker).not.toHaveProperty('csvDocument');
    expect(marker).not.toHaveProperty('contactEmail');
    expect(marker).not.toHaveProperty('contactPhone');
    expect(marker).not.toHaveProperty('originalCaseReference');
  });

  it('creates a NEW workitem for every READY record, cached and freshly fetched alike', async () => {
    const { deps, repository } = makeDeps();

    await runAdditionalEvidenceSyncRefresh('run-1', deps, () => false, 'trigger-1');

    expect(repository.createWorkItemIfMissing).toHaveBeenCalledWith(expect.objectContaining({
      objectUuid: 'uuid-cached', submissionReference: 'OF-EXTRA-cached', status: 'NEW',
    }));
    expect(repository.createWorkItemIfMissing).toHaveBeenCalledWith(expect.objectContaining({
      objectUuid: 'uuid-new', submissionReference: 'OF-EXTRA-new', status: 'NEW', originalCaseReference: 'OF-HOOFD01',
    }));
  });

  it('keeps two submissions naming the same origineleKenmerk as two independent workitems, never merged', async () => {
    const { deps, repository } = makeDeps();
    deps.objectsClient = {
      collectObjects: jest.fn().mockResolvedValue([
        objectResource('uuid-a', 'OF-EXTRA-a', 'csv://a'),
        objectResource('uuid-b', 'OF-EXTRA-b', 'csv://b'),
      ]),
    } as unknown as ObjectsClient;
    (deps.openZaakClient.getDocumentText as jest.Mock).mockImplementation(async () => fixture('additional-evidence-001.csv'));
    (deps.sourceCacheStore.getItems as jest.Mock).mockResolvedValue(new Map());

    await runAdditionalEvidenceSyncRefresh('run-1', deps, () => false, 'trigger-1');

    expect(repository.createWorkItemIfMissing).toHaveBeenCalledWith(expect.objectContaining({ objectUuid: 'uuid-a', originalCaseReference: 'OF-HOOFD01' }));
    expect(repository.createWorkItemIfMissing).toHaveBeenCalledWith(expect.objectContaining({ objectUuid: 'uuid-b', originalCaseReference: 'OF-HOOFD01' }));
    expect(repository.createWorkItemIfMissing).toHaveBeenCalledTimes(2);
  });

  it('still creates a minimal workitem for a submission whose CSV download failed, so it never disappears from the werkvoorraad', async () => {
    const { deps, repository } = makeDeps();

    await runAdditionalEvidenceSyncRefresh('run-1', deps, () => false, 'trigger-1');

    expect(repository.createWorkItemIfMissing).toHaveBeenCalledWith(expect.objectContaining({
      objectUuid: 'uuid-broken', submissionReference: 'OF-EXTRA-broken', status: 'NEW',
    }));
  });

  it('still creates a minimal workitem for a submission whose CSV content failed to parse (missing origineleKenmerk)', async () => {
    const { deps, repository } = makeDeps();
    deps.objectsClient = {
      collectObjects: jest.fn().mockResolvedValue([objectResource('uuid-corrupt', 'OF-EXTRA-corrupt', 'csv://corrupt')]),
    } as unknown as ObjectsClient;
    (deps.openZaakClient.getDocumentText as jest.Mock).mockImplementation(async (url: string) => (
      url === 'csv://corrupt' ? fixture('additional-evidence-missing-original-reference.csv') : ''
    ));
    (deps.sourceCacheStore.getItems as jest.Mock).mockResolvedValue(new Map());

    await runAdditionalEvidenceSyncRefresh('run-1', deps, () => false, 'trigger-1');

    expect(repository.createWorkItemIfMissing).toHaveBeenCalledWith(expect.objectContaining({
      objectUuid: 'uuid-corrupt', submissionReference: 'OF-EXTRA-corrupt', status: 'NEW',
    }));
  });

  it('does nothing when the runId is no longer the active refresh (superseded by a newer claim)', async () => {
    const { deps, sourceCacheStore, getDocumentText } = makeDeps();
    sourceCacheStore.getState.mockResolvedValue({ runId: 'run-2', status: 'REFRESHING', startedAt: new Date().toISOString() });

    await runAdditionalEvidenceSyncRefresh('run-1', deps, () => false, 'trigger-1');

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

    await runAdditionalEvidenceSyncRefresh('run-1', deps, () => false, 'trigger-1');

    expect(getDocumentText).not.toHaveBeenCalled();
    expect(sourceCacheStore.finalizeRefresh).toHaveBeenCalledWith('run-1', 'READY', expect.any(Date), {});
  });

  it('reaches its time cutoff before the CSV phase and finalizes as FAILED with a technical reason, not READY_WITH_ERRORS', async () => {
    const { deps, sourceCacheStore, getDocumentText } = makeDeps();

    await runAdditionalEvidenceSyncRefresh('run-1', deps, () => true, 'trigger-1');

    expect(getDocumentText).not.toHaveBeenCalled();
    expect(sourceCacheStore.finalizeRefresh).toHaveBeenCalledWith('run-1', 'FAILED', expect.any(Date), { failureReason: 'TIME_LIMIT_REACHED' });
  });

  it('never initializes a workitem once the cutoff is reached right after the CSV phase', async () => {
    const { deps, sourceCacheStore, repository } = makeDeps();
    let cutoffChecks = 0;
    const isPastCutoff = () => {
      cutoffChecks += 1;
      return cutoffChecks > 1;
    };

    await runAdditionalEvidenceSyncRefresh('run-1', deps, isPastCutoff, 'trigger-1');

    expect(sourceCacheStore.putReady).toHaveBeenCalledWith(expect.objectContaining({ objectUuid: 'uuid-new' }));
    expect(repository.createWorkItemIfMissing).not.toHaveBeenCalled();
    expect(sourceCacheStore.finalizeRefresh).toHaveBeenCalledWith('run-1', 'FAILED', expect.any(Date), { failureReason: 'TIME_LIMIT_REACHED' });
  });

  it('rejects an object whose formName does not match Additional Evidence, marking it FAILED and never creating a workitem for it', async () => {
    const objectsClient = {
      collectObjects: jest.fn().mockResolvedValue([
        { uuid: 'uuid-wrong-form', record: { data: { formName: 'Aanmelden stroomaansluiting woningbouw', reference: 'OF-wrong', csv: 'csv://wrong' } } } as ObjectResource,
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
    const repository = { createWorkItemIfMissing: jest.fn() };
    const deps: AdditionalEvidenceSyncWorkerDependencies = {
      objectsClient,
      openZaakClient,
      sourceCacheStore: sourceCacheStore as unknown as AdditionalEvidenceSourceCacheStore,
      repository: repository as unknown as AdditionalEvidenceRepository,
    };

    await runAdditionalEvidenceSyncRefresh('run-1', deps, () => false, 'trigger-1');

    expect(openZaakClient.getDocumentText).not.toHaveBeenCalled();
    expect(sourceCacheStore.putFailed).toHaveBeenCalledWith(expect.objectContaining({ objectUuid: 'uuid-wrong-form', status: 'FAILED' }));
    expect(sourceCacheStore.finalizeRefresh).toHaveBeenCalledWith('run-1', 'READY_WITH_ERRORS', expect.any(Date), { failedCount: 1 });
    expect(repository.createWorkItemIfMissing).not.toHaveBeenCalled();
  });
});
