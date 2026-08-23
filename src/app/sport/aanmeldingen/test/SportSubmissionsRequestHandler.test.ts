import { FakeAuditTrail } from '../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../../shared/authorization/tests/FakePermissionRepository';
import { CachedSportSubmission, SPORT_CACHE_VERSION } from '../../cache/SportCacheItem';
import { SportCacheStore } from '../../cache/SportCacheStore';
import { SportSubmissionsRequestHandler } from '../SportSubmissionsRequestHandler';

// A separate constant, not inlined into cachedSubmission()'s return: mixing literal keys with a same-shaped
// `...dataOverrides` spread in one object literal makes TS flag every default field as "always overwritten".
const DEFAULT_DATA: CachedSportSubmission['data'] = {
  formName: 'Aanmelden sportactiviteit',
  submittedAt: new Date('2026-08-20T10:00:00Z'),
  district: 'dukenburg',
  aanmeldType: 'volwassene',
  childFirstName: '',
  childLastName: '',
  childBirthDate: '',
  educationType: '',
  primarySchool: '',
  schoolGroup: '',
  secondarySchool: '',
  contactFirstName: 'Test',
  contactLastName: 'Persoon',
  contactBirthDate: '',
  phone: '0612345678',
  email: 'test@example.invalid',
  secondContactFirstName: '',
  secondContactLastName: '',
  secondContactPhone: '',
  secondContactEmail: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  childInSportsClub: '',
  otherActivity: '',
  outreachWorkerName: '',
  outreachWorkerOrganization: '',
  consentContact: '',
  consentDataUse: '',
  consentPhotos: '',
  remark: '',
  activities: ['Zwemmen'],
};

function cachedSubmission(
  overrides: Partial<Omit<CachedSportSubmission, 'data'>> & { objectUuid: string; data?: Partial<CachedSportSubmission['data']> },
): CachedSportSubmission {
  const { data: dataOverrides, ...rest } = overrides;
  const defaults: Omit<CachedSportSubmission, 'data'> = {
    status: 'READY',
    objectUuid: overrides.objectUuid,
    reference: `OF-${overrides.objectUuid}`,
    hasPdf: false,
    registrationAt: '2026-08-01',
    cachedAt: '2026-08-20T00:00:00.000Z',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    cacheVersion: SPORT_CACHE_VERSION,
  };
  return { ...defaults, ...rest, data: { ...DEFAULT_DATA, ...dataOverrides } };
}

function authorizationServiceFor(email: string, districts: string[]): AuthorizationService {
  const repository = new FakePermissionRepository();
  repository.seedGrants(email, [{ resource: 'sport', actions: ['view'], scopes: { districts } }]);
  return new AuthorizationService(repository, new FakeAuditTrail());
}

describe('SportSubmissionsRequestHandler', () => {
  it('denies a medewerker without any Sport grant', async () => {
    const service = new AuthorizationService(new FakePermissionRepository(), new FakeAuditTrail());
    const cacheStore = { getState: jest.fn(), readActiveItems: jest.fn() } as unknown as SportCacheStore;
    const handler = new SportSubmissionsRequestHandler(service, cacheStore);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, undefined, 'trace-1');

    expect(response.statusCode).toBe(403);
  });

  it('returns 202 with Retry-After while an active refresh is running, without reading the cache', async () => {
    const service = authorizationServiceFor('medewerker@nijmegen.nl', ['dukenburg']);
    const cacheStore = {
      getState: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'REFRESHING', startedAt: new Date().toISOString() }),
      readActiveItems: jest.fn(),
    } as unknown as SportCacheStore;
    const handler = new SportSubmissionsRequestHandler(service, cacheStore);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, undefined, 'trace-1');

    expect(response.statusCode).toBe(202);
    expect(response.headers?.['Retry-After']).toBeDefined();
    expect(response.headers?.['X-Correlation-Id']).toBe('trace-1');
    expect(cacheStore.readActiveItems).not.toHaveBeenCalled();
  });

  it('shows only the districts the medewerker is allowed to see, newest first, capped at 30', async () => {
    const service = authorizationServiceFor('medewerker@nijmegen.nl', ['dukenburg']);
    const cached: CachedSportSubmission[] = [
      cachedSubmission({ objectUuid: 'allowed-old', data: { district: 'dukenburg', submittedAt: new Date('2026-08-01T00:00:00Z') } }),
      cachedSubmission({ objectUuid: 'allowed-new', data: { district: 'dukenburg', submittedAt: new Date('2026-08-20T00:00:00Z') } }),
      cachedSubmission({ objectUuid: 'not-allowed', data: { district: 'nijmegenNoord', submittedAt: new Date('2026-08-21T00:00:00Z') } }),
      ...Array.from({ length: 35 }, (_, i) => cachedSubmission({
        objectUuid: `extra-${i}`,
        data: { district: 'dukenburg', submittedAt: new Date(Date.UTC(2026, 6, 1 + i)) },
      })),
    ];
    const cacheStore = {
      getState: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'READY', startedAt: new Date().toISOString() }),
      readActiveItems: jest.fn().mockResolvedValue({ submissions: cached, failedMarkers: [] }),
    } as unknown as SportCacheStore;
    const handler = new SportSubmissionsRequestHandler(service, cacheStore);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, undefined, 'trace-1');
    const body = response.body ?? '';

    expect(response.statusCode).toBe(200);
    expect(body).toContain('OF-allowed-new');
    expect(body).toContain('OF-allowed-old');
    expect(body).not.toContain('OF-not-allowed');
    expect((body.match(/sport-record__summary/g) ?? [])).toHaveLength(30);
    // The most recently submitted allowed record (allowed-new, 20 aug) sorts before an older allowed one (allowed-old, 1 aug).
    expect(body.indexOf('OF-allowed-new')).toBeLessThan(body.indexOf('OF-allowed-old'));

    // 37 allowed records total, 30 shown: "Meer tonen" must offer the remaining 7 without repeating any of the first 30.
    const cursorMatch = body.match(/data-cursor="([^"]+)"/);
    expect(cursorMatch).not.toBeNull();
    const nextPageResponse = await handler.handleRequest(
      { principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, { cursor: cursorMatch![1] }, 'trace-2',
    );
    const nextPageBody = nextPageResponse.body ?? '';
    expect((nextPageBody.match(/sport-record__summary/g) ?? [])).toHaveLength(7);
    expect(nextPageBody).not.toContain('OF-allowed-new');
    expect(nextPageBody).not.toContain('data-sport-load-more');
  });

  it('shows the stale and failed-document warnings together with a document number, without hiding what did load', async () => {
    const service = authorizationServiceFor('medewerker@nijmegen.nl', ['dukenburg']);
    const cacheStore = {
      getState: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'FAILED', startedAt: new Date().toISOString() }),
      readActiveItems: jest.fn().mockResolvedValue({
        submissions: [cachedSubmission({ objectUuid: 'still-visible' })],
        failedMarkers: [{
          status: 'FAILED',
          objectUuid: 'broken-uuid',
          reference: 'OF-broken',
          failureReason: 'CSV_FETCH_ERROR',
          lastAttemptAt: '2026-08-20T00:00:00.000Z',
          expiresAt: 0,
        }],
      }),
    } as unknown as SportCacheStore;
    const handler = new SportSubmissionsRequestHandler(service, cacheStore);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, undefined, 'trace-1');
    const body = response.body ?? '';

    expect(response.statusCode).toBe(200);
    expect(body.match(/utrecht-alert--warning/g)).toHaveLength(2);
    expect(body).toContain('OF-still-visible');
    expect(body).toContain('1 overgeslagen');
    expect(body).toContain('OF-broken (document broken-uuid)');
  });

  it('shows a warning plus the normal empty state, not a 500, for a cold cache when the refresh itself failed', async () => {
    const service = authorizationServiceFor('medewerker@nijmegen.nl', ['dukenburg']);
    const cacheStore = {
      getState: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'FAILED', startedAt: new Date().toISOString() }),
      readActiveItems: jest.fn().mockResolvedValue({ submissions: [], failedMarkers: [] }),
    } as unknown as SportCacheStore;
    const handler = new SportSubmissionsRequestHandler(service, cacheStore);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, undefined, 'trace-1');
    const body = response.body ?? '';

    expect(response.statusCode).toBe(200);
    expect(body).toContain('utrecht-alert--warning');
    expect(body).toContain('Er zijn geen Sportaanmeldingen');
  });

  it('returns a 500 without leaking the underlying error when the cache read itself fails', async () => {
    const service = authorizationServiceFor('medewerker@nijmegen.nl', ['dukenburg']);
    const cacheStore = {
      getState: jest.fn().mockResolvedValue(undefined),
      readActiveItems: jest.fn().mockRejectedValue(new Error('DynamoDB unavailable')),
    } as unknown as SportCacheStore;
    const handler = new SportSubmissionsRequestHandler(service, cacheStore);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, undefined, 'trace-1');

    expect(response.statusCode).toBe(500);
    expect(response.body ?? '').not.toContain('DynamoDB unavailable');
  });
});
