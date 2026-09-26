import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { ProjectDetailsStore } from '../persistence/ProjectDetailsStore';
import { ProjectDetailsLocationDownloadHandler } from '../ui/ProjectDetailsLocationDownloadHandler';

const SOURCE_POLYGON = { type: 'Polygon' as const, coordinates: [[[5.86, 51.85], [5.87, 51.85], [5.87, 51.86], [5.86, 51.85]]] };
const MANUAL_POLYGON = { type: 'Polygon' as const, coordinates: [[[5.80, 51.81], [5.81, 51.81], [5.81, 51.82], [5.80, 51.81]]] };

function makeAuthorizationService(): AuthorizationService {
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'medewerker' } }),
    requireAuthorization: jest.fn().mockResolvedValue(undefined),
    denyAccess: jest.fn().mockResolvedValue({ statusCode: 403 }),
  } as unknown as AuthorizationService;
}

function makeCaseRepository(caseExists = true): jest.Mocked<Pick<WoonbehoefteCaseRepository, 'getCase'>> {
  return { getCase: jest.fn().mockResolvedValue(caseExists ? { caseReference: 'OF-1' } : undefined) };
}

function makeStore(): jest.Mocked<Pick<ProjectDetailsStore, 'getWorkVersion'>> {
  return { getWorkVersion: jest.fn() };
}

function workVersion(overrides: Record<string, unknown> = {}) {
  return {
    caseReference: 'OF-1',
    readableProjectName: 'Voorbeeldproject',
    projectDescription: '',
    additionalInformation: '',
    projectWideNotes: '',
    housingLines: {},
    collectiveFacilityLines: {},
    kovaLines: {},
    createdAt: '',
    createdBy: '',
    updatedAt: '',
    updatedBy: '',
    ...overrides,
  };
}

describe('ProjectDetailsLocationDownloadHandler', () => {
  it('returns 404 when the case itself does not exist', async () => {
    const caseRepository = makeCaseRepository(false);
    const store = makeStore();
    const handler = new ProjectDetailsLocationDownloadHandler(
      makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, store as unknown as ProjectDetailsStore,
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-1');

    expect(response.statusCode).toBe(404);
    expect(store.getWorkVersion).not.toHaveBeenCalled();
  });

  it('returns 404 when there is no werkversie at all (NEW/PENDING/FAILED)', async () => {
    const caseRepository = makeCaseRepository();
    const store = makeStore();
    store.getWorkVersion.mockResolvedValue(undefined);
    const handler = new ProjectDetailsLocationDownloadHandler(
      makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, store as unknown as ProjectDetailsStore,
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-1');

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 when the werkversie exists but has neither a bron- nor een handmatige polygon', async () => {
    const caseRepository = makeCaseRepository();
    const store = makeStore();
    store.getWorkVersion.mockResolvedValue(workVersion() as never);
    const handler = new ProjectDetailsLocationDownloadHandler(
      makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, store as unknown as ProjectDetailsStore,
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-1');

    expect(response.statusCode).toBe(404);
  });

  it('downloads the bronpolygon when no handmatige locatie exists, as a JSON attachment named after the OF-kenmerk', async () => {
    const caseRepository = makeCaseRepository();
    const store = makeStore();
    store.getWorkVersion.mockResolvedValue(workVersion({ sourceLocationPolygon: SOURCE_POLYGON }) as never);
    const handler = new ProjectDetailsLocationDownloadHandler(
      makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, store as unknown as ProjectDetailsStore,
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-1');

    expect(response.statusCode).toBe(200);
    expect(response.headers?.['Content-Type']).toBe('application/json');
    expect(response.headers?.['Content-Disposition']).toBe('attachment; filename="OF-1.json"');
    const body = JSON.parse(response.body as string);
    expect(body.features).toHaveLength(1);
    expect(body.features[0].geometry).toEqual(SOURCE_POLYGON);
    expect(body.features[0].properties).toEqual({});
  });

  it('prefers the handmatige polygon over the bronpolygon when both exist', async () => {
    const caseRepository = makeCaseRepository();
    const store = makeStore();
    store.getWorkVersion.mockResolvedValue(
      workVersion({ sourceLocationPolygon: SOURCE_POLYGON, manualLocationPolygon: MANUAL_POLYGON }) as never,
    );
    const handler = new ProjectDetailsLocationDownloadHandler(
      makeAuthorizationService(), caseRepository as unknown as WoonbehoefteCaseRepository, store as unknown as ProjectDetailsStore,
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-1');

    const body = JSON.parse(response.body as string);
    expect(body.features[0].geometry).toEqual(MANUAL_POLYGON);
  });

  it('checks woonbehoefte:view, not woonbehoefte:manage: a view-only medewerker can download', async () => {
    const caseRepository = makeCaseRepository();
    const store = makeStore();
    store.getWorkVersion.mockResolvedValue(workVersion({ sourceLocationPolygon: SOURCE_POLYGON }) as never);
    const authorizationService = makeAuthorizationService();
    const handler = new ProjectDetailsLocationDownloadHandler(
      authorizationService, caseRepository as unknown as WoonbehoefteCaseRepository, store as unknown as ProjectDetailsStore,
    );

    const response = await handler.handleRequest({ principalId: 'medewerker' }, 'OF-1');

    expect(response.statusCode).toBe(200);
    expect((authorizationService.requireAuthorization as jest.Mock)).toHaveBeenCalledWith(
      expect.anything(), { resource: 'woonbehoefte', action: 'view' },
    );
  });
});
