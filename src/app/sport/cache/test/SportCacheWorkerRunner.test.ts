import * as fs from 'fs';
import * as path from 'path';
import { ObjectsClient } from '../../../../shared/clients/objects/ObjectsClient';
import { ObjectResource } from '../../../../shared/clients/objects/ObjectsResponse';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { CachedSportSubmission, SPORT_CACHE_VERSION } from '../SportCacheItem';
import { SportCacheStore } from '../SportCacheStore';
import { runSportCacheRefresh, SportCacheWorkerDependencies } from '../SportCacheWorkerRunner';

const samplesDir = path.join(__dirname, '../../sportdata/test/samples');

function fixture(name: string): string {
  return fs.readFileSync(path.join(samplesDir, name), 'utf-8');
}

function objectResource(uuid: string, reference: string, csvUrl: string): ObjectResource {
  return { uuid, record: { data: { reference, csv: csvUrl }, registrationAt: '2026-08-01' } } as ObjectResource;
}

function cachedSubmission(objectUuid: string): CachedSportSubmission {
  return {
    status: 'READY',
    objectUuid,
    reference: 'OF-cached',
    hasPdf: false,
    registrationAt: '2026-07-01',
    data: {} as CachedSportSubmission['data'],
    cachedAt: '2026-07-01T00:00:00.000Z',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    cacheVersion: SPORT_CACHE_VERSION,
  };
}

function makeDeps() {
  const csvByUrl: Record<string, string> = {
    'csv://new': fixture('sport-submission-child-dukenburg.csv'),
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

  const cacheStore = {
    getState: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'REFRESHING', startedAt: new Date().toISOString() }),
    getItems: jest.fn().mockResolvedValue(new Map([['uuid-cached', cachedSubmission('uuid-cached')]])),
    putReady: jest.fn().mockResolvedValue(undefined),
    putFailed: jest.fn().mockResolvedValue(undefined),
    finalizeRefresh: jest.fn().mockResolvedValue(true),
  };

  const deps: SportCacheWorkerDependencies = {
    objectsClient, openZaakClient, cacheStore: cacheStore as unknown as SportCacheStore,
  };

  return { deps, cacheStore, getDocumentText };
}

describe('runSportCacheRefresh', () => {
  it('skips the already-cached UUID, caches the new one, marks the broken one FAILED, and finishes READY_WITH_ERRORS', async () => {
    const { deps, cacheStore, getDocumentText } = makeDeps();

    await runSportCacheRefresh('run-1', deps, () => false, 'trigger-1');

    expect(getDocumentText.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining(['csv://new', 'csv://broken']));
    expect(getDocumentText.mock.calls.map((call) => call[0])).not.toContain('csv://cached');
    expect(cacheStore.putReady).toHaveBeenCalledWith(expect.objectContaining({ objectUuid: 'uuid-new', status: 'READY' }));
    expect(cacheStore.putFailed).toHaveBeenCalledWith(expect.objectContaining({ objectUuid: 'uuid-broken', status: 'FAILED' }));
    expect(cacheStore.finalizeRefresh).toHaveBeenCalledWith('run-1', 'READY_WITH_ERRORS', expect.any(Date), { failedCount: 1 });
  });

  it('does nothing when the runId is no longer the active refresh (superseded by a newer claim)', async () => {
    const { deps, cacheStore, getDocumentText } = makeDeps();
    cacheStore.getState.mockResolvedValue({ runId: 'run-2', status: 'REFRESHING', startedAt: new Date().toISOString() });

    await runSportCacheRefresh('run-1', deps, () => false, 'trigger-1');

    expect(getDocumentText).not.toHaveBeenCalled();
    expect(cacheStore.finalizeRefresh).not.toHaveBeenCalled();
  });

  it('makes no Open Zaak calls at all on a warm run where every object is already cached on the current version', async () => {
    const { deps, cacheStore, getDocumentText } = makeDeps();
    cacheStore.getItems.mockResolvedValue(new Map([
      ['uuid-cached', cachedSubmission('uuid-cached')],
      ['uuid-new', cachedSubmission('uuid-new')],
      ['uuid-broken', cachedSubmission('uuid-broken')],
    ]));

    await runSportCacheRefresh('run-1', deps, () => false, 'trigger-1');

    expect(getDocumentText).not.toHaveBeenCalled();
    expect(cacheStore.finalizeRefresh).toHaveBeenCalledWith('run-1', 'READY', expect.any(Date), {});
  });

  it('reaches its time cutoff before the CSV phase and finalizes as FAILED with a technical reason, not READY_WITH_ERRORS', async () => {
    const { deps, cacheStore, getDocumentText } = makeDeps();

    await runSportCacheRefresh('run-1', deps, () => true, 'trigger-1');

    expect(getDocumentText).not.toHaveBeenCalled();
    expect(cacheStore.finalizeRefresh).toHaveBeenCalledWith('run-1', 'FAILED', expect.any(Date), { failureReason: 'TIME_LIMIT_REACHED' });
  });

  it('keeps already-written submissions when the cutoff is reached right after the write phase, but still finalizes as FAILED', async () => {
    const { deps, cacheStore } = makeDeps();
    let cutoffChecks = 0;
    const isPastCutoff = () => {
      cutoffChecks += 1;
      return cutoffChecks > 1;
    };

    await runSportCacheRefresh('run-1', deps, isPastCutoff, 'trigger-1');

    expect(cacheStore.putReady).toHaveBeenCalledWith(expect.objectContaining({ objectUuid: 'uuid-new' }));
    expect(cacheStore.finalizeRefresh).toHaveBeenCalledWith('run-1', 'FAILED', expect.any(Date), { failureReason: 'TIME_LIMIT_REACHED' });
  });

  it('never caches a submission with an unknown district as READY, marking it FAILED instead', async () => {
    // stadsdeel accepts any string in the CSV schema; the worker itself is the fail-closed check against SPORT_DISTRICTS.
    const unknownDistrictCsv = fixture('sport-submission-child-dukenburg.csv').replace(',dukenburg,ja,', ',onbekendeWijk,ja,');
    const objectsClient = {
      collectObjects: jest.fn().mockResolvedValue([objectResource('uuid-unknown-district', 'OF-unknown', 'csv://unknown-district')]),
    } as unknown as ObjectsClient;
    const openZaakClient = { getDocumentText: jest.fn().mockResolvedValue(unknownDistrictCsv) } as unknown as OpenZaakClient;
    const cacheStore = {
      getState: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'REFRESHING', startedAt: new Date().toISOString() }),
      getItems: jest.fn().mockResolvedValue(new Map()),
      putReady: jest.fn().mockResolvedValue(undefined),
      putFailed: jest.fn().mockResolvedValue(undefined),
      finalizeRefresh: jest.fn().mockResolvedValue(true),
    };
    const deps: SportCacheWorkerDependencies = { objectsClient, openZaakClient, cacheStore: cacheStore as unknown as SportCacheStore };

    await runSportCacheRefresh('run-1', deps, () => false, 'trigger-1');

    expect(cacheStore.putReady).not.toHaveBeenCalled();
    expect(cacheStore.putFailed).toHaveBeenCalledWith(expect.objectContaining({ objectUuid: 'uuid-unknown-district', status: 'FAILED' }));
    expect(cacheStore.finalizeRefresh).toHaveBeenCalledWith('run-1', 'READY_WITH_ERRORS', expect.any(Date), { failedCount: 1 });
  });
});
