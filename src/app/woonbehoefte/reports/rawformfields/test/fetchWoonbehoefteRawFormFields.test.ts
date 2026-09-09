import { OpenZaakClient } from '../../../../../shared/clients/open-zaak/OpenZaakClient';
import { WoonbehoefteCase } from '../../../domain/WoonbehoefteCase';
import { WoonbehoefteSourceRecord } from '../../../domain/WoonbehoefteSource';
import { WoonbehoefteCaseWithSource } from '../../../overview/WoonbehoefteOverviewViewModel';
import { fetchWoonbehoefteRawFormFields } from '../fetchWoonbehoefteRawFormFields';

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
    csvDocument: { documentId: `doc-${caseReference}`, url: `https://open-zaak.example.invalid/csv/${caseReference}`, role: 'CSV' },
    ...overrides,
  };
}

function csv(projectName: string): string {
  return `projectNaam\n"${projectName}"\n`;
}

describe('fetchWoonbehoefteRawFormFields', () => {
  it('fetches and parses the primary CSV for every case that has one', async () => {
    const entries: WoonbehoefteCaseWithSource[] = [
      { woonbehoefteCase: woonbehoefteCase('OF-1'), source: source('OF-1') },
      { woonbehoefteCase: woonbehoefteCase('OF-2'), source: source('OF-2') },
    ];
    const getDocumentText = jest.fn()
      .mockImplementation(async (url: string) => csv(url.endsWith('OF-1') ? 'Project Een' : 'Project Twee'));
    const client = { getDocumentText } as unknown as OpenZaakClient;

    const result = await fetchWoonbehoefteRawFormFields(client, entries, { principalId: 'woonbehoefte-excel-worker' });

    expect(result.get('OF-1')?.fields?.values.projectNaam).toBe('Project Een');
    expect(result.get('OF-2')?.fields?.values.projectNaam).toBe('Project Twee');
    expect(getDocumentText).toHaveBeenCalledTimes(2);
  });

  it('skips a case with no source or no cached csvDocument, without touching Open Zaak for it', async () => {
    const entries: WoonbehoefteCaseWithSource[] = [
      { woonbehoefteCase: woonbehoefteCase('OF-1'), source: undefined },
      { woonbehoefteCase: woonbehoefteCase('OF-2'), source: source('OF-2', { csvDocument: undefined }) },
    ];
    const getDocumentText = jest.fn();
    const client = { getDocumentText } as unknown as OpenZaakClient;

    const result = await fetchWoonbehoefteRawFormFields(client, entries, { principalId: 'woonbehoefte-excel-worker' });

    expect(getDocumentText).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it('turns a per-case fetch failure into a warning outcome, without throwing, and still processes the rest', async () => {
    const entries: WoonbehoefteCaseWithSource[] = [
      { woonbehoefteCase: woonbehoefteCase('OF-1'), source: source('OF-1') },
      { woonbehoefteCase: woonbehoefteCase('OF-2'), source: source('OF-2') },
    ];
    const getDocumentText = jest.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('OF-1')) {
        throw new Error('Open Zaak unavailable');
      }
      return csv('Project Twee');
    });
    const client = { getDocumentText } as unknown as OpenZaakClient;

    const result = await fetchWoonbehoefteRawFormFields(client, entries, { principalId: 'woonbehoefte-excel-worker' });

    expect(result.get('OF-1')?.fields).toBeUndefined();
    expect(result.get('OF-1')?.warning).toContain('kon niet worden geladen');
    expect(result.get('OF-2')?.fields?.values.projectNaam).toBe('Project Twee');
  });

  it('respects a small fixed concurrency, never firing every request at once', async () => {
    const entries: WoonbehoefteCaseWithSource[] = Array.from({ length: 10 }, (_, i) => ({
      woonbehoefteCase: woonbehoefteCase(`OF-${i}`), source: source(`OF-${i}`),
    }));
    let concurrentCalls = 0;
    let maxConcurrentCalls = 0;
    const getDocumentText = jest.fn().mockImplementation(async () => {
      concurrentCalls += 1;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
      await new Promise((resolve) => { setTimeout(resolve, 1); });
      concurrentCalls -= 1;
      return csv('Project');
    });
    const client = { getDocumentText } as unknown as OpenZaakClient;

    await fetchWoonbehoefteRawFormFields(client, entries, { principalId: 'woonbehoefte-excel-worker' });

    expect(maxConcurrentCalls).toBeLessThanOrEqual(4);
    expect(getDocumentText).toHaveBeenCalledTimes(10);
  });
});
