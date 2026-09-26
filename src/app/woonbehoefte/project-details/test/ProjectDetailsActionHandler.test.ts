import { randomBytes } from 'crypto';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../shared/authorization/PermissionEvaluator';
import { CSRF_COOKIE_NAME } from '../../../../shared/security/csrf/CsrfProtection';
import { ProjectDetailsStore } from '../persistence/ProjectDetailsStore';
import { ProjectDetailsActionHandler } from '../ui/ProjectDetailsActionHandler';

const csrfToken = randomBytes(32).toString('base64url');
const cookieHeader = `${CSRF_COOKIE_NAME}=${csrfToken}`;

function makeAuthorizationService(): AuthorizationService {
  const evaluator = new PermissionEvaluator([{ resource: 'woonbehoefte', actions: ['manage'] }]);
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'medewerker' }, evaluator }),
    requireAuthorization: jest.fn().mockResolvedValue(undefined),
    denyAccess: jest.fn().mockResolvedValue({ statusCode: 403 }),
  } as unknown as AuthorizationService;
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function makeStore(): jest.Mocked<Pick<
  ProjectDetailsStore,
  'getWorkVersion' | 'getAttempt' | 'updateProject' | 'updateAdditionalInformation' | 'updateProjectWideNotes' | 'upsertLine' | 'deleteLine'
  | 'startEmptyWorkVersion' | 'setManualLocation'
>> {
  return {
    getWorkVersion: jest.fn(),
    getAttempt: jest.fn().mockResolvedValue(undefined),
    updateProject: jest.fn().mockResolvedValue('OK'),
    updateAdditionalInformation: jest.fn().mockResolvedValue('OK'),
    updateProjectWideNotes: jest.fn().mockResolvedValue('OK'),
    upsertLine: jest.fn().mockResolvedValue('OK'),
    deleteLine: jest.fn().mockResolvedValue('OK'),
    startEmptyWorkVersion: jest.fn().mockResolvedValue('CREATED'),
    setManualLocation: jest.fn().mockResolvedValue('OK'),
  };
}

function readyWorkVersion(overrides: Partial<ReturnType<typeof baseWorkVersion>> = {}): ReturnType<typeof baseWorkVersion> {
  return { ...baseWorkVersion(), ...overrides };
}

function baseWorkVersion() {
  return {
    caseReference: 'OF-1',
    readableProjectName: '',
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
  };
}

// De geojson.io-export uit 05-tests-en-samples.md: vijf unieke hoekpunten plus sluitpunt.
const VALID_MANUAL_POLYGON_TEXT = JSON.stringify({
  type: 'Polygon',
  coordinates: [[
    [5.861824, 51.8464654], [5.8623068, 51.8464787], [5.8622317, 51.8462732],
    [5.8619313, 51.84626], [5.8614271, 51.8463528], [5.861824, 51.8464654],
  ]],
});

function makeAuditTrail(): AuditTrail {
  return { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditTrail;
}

describe('ProjectDetailsActionHandler', () => {
  it('updates project fields and audits without any field content, only caseReference/action', async () => {
    const store = makeStore();
    const auditTrail = makeAuditTrail();
    const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, auditTrail);

    const response = await handler.handleProject(
      { principalId: 'medewerker', email: 'medewerker@example.nl' }, 'OF-1', cookieHeader,
      form({ csrfToken, readableProjectName: 'Nieuwe naam', projectDescription: 'Nieuwe toelichting' }), false,
    );

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toContain('#pd-project-card');
    expect(store.updateProject).toHaveBeenCalledWith('OF-1', 'Nieuwe naam', 'Nieuwe toelichting', 'medewerker@example.nl');
    expect((auditTrail.record as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'WOONBEHOEFTE_PROJECT_DETAILS_UPDATED',
      metadata: expect.objectContaining({ caseReference: 'OF-1', changeAction: 'PROJECT_UPDATED' }),
    }));
    const [auditCall] = (auditTrail.record as jest.Mock).mock.calls[0];
    expect(JSON.stringify(auditCall)).not.toContain('Nieuwe naam');
  });

  it('rejects a project update without a readableProjectName, writing nothing', async () => {
    const store = makeStore();
    const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, makeAuditTrail());

    const response = await handler.handleProject(
      { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ csrfToken, readableProjectName: '', projectDescription: 'x' }), false,
    );

    expect(response.statusCode).toBe(400);
    expect(store.updateProject).not.toHaveBeenCalled();
  });

  it('starts an empty werkversie for a NEW dossier and audits MANUALLY_STARTED, not INITIALIZED', async () => {
    const store = makeStore();
    store.getWorkVersion.mockResolvedValue(undefined);
    const auditTrail = makeAuditTrail();
    const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, auditTrail);

    const response = await handler.handleManualStart({ principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ csrfToken }), false);

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toContain('#pd-project-card');
    expect(store.startEmptyWorkVersion).toHaveBeenCalledWith('OF-1', 'medewerker');
    expect((auditTrail.record as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ caseReference: 'OF-1', changeAction: 'MANUALLY_STARTED' }),
    }));
  });

  it('does nothing for a dossier that already has a werkversie, even on a duplicate POST', async () => {
    const store = makeStore();
    store.getWorkVersion.mockResolvedValue({ caseReference: 'OF-1' } as never);
    const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, makeAuditTrail());

    const response = await handler.handleManualStart({ principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ csrfToken }), false);

    expect(response.statusCode).toBe(303);
    expect(store.startEmptyWorkVersion).not.toHaveBeenCalled();
  });

  it('creates a new wonen line with order appended after existing lines', async () => {
    const store = makeStore();
    store.getWorkVersion.mockResolvedValue({
      caseReference: 'OF-1',
      readableProjectName: '',
      projectDescription: '',
      additionalInformation: '',
      projectWideNotes: '',
      housingLines: { 'line-1': { lineId: 'line-1', order: 0, type: 'WOONHUIS', connectionCount: 1, connectionType: '', otherDetails: '' } },
      collectiveFacilityLines: {},
      kovaLines: {},
      createdAt: '',
      createdBy: '',
      updatedAt: '',
      updatedBy: '',
    });
    const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, makeAuditTrail());

    const response = await handler.handleLineCreate(
      { principalId: 'medewerker' }, 'OF-1', 'wonen', cookieHeader,
      form({ csrfToken, type: 'APPARTEMENTEN', connectionCount: '3', connectionType: '3x25A', otherDetails: '' }), false,
    );

    expect(response.statusCode).toBe(303);
    const [, category, line, isNew] = store.upsertLine.mock.calls[0];
    expect(category).toBe('WONEN');
    expect(isNew).toBe(true);
    expect(line).toMatchObject({ order: 1, type: 'APPARTEMENTEN', connectionCount: 3 });
    expect(response.headers?.Location).toContain(`#pd-wonen-line-${line.lineId}`);
  });

  it('rejects a negative or fractional connectionCount from a manipulated POST, even though the HTML input only suggests min=0', async () => {
    const store = makeStore();
    store.getWorkVersion.mockResolvedValue({
      caseReference: 'OF-1',
      readableProjectName: '',
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
    });
    const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, makeAuditTrail());

    const response = await handler.handleLineCreate(
      { principalId: 'medewerker' }, 'OF-1', 'wonen', cookieHeader,
      form({ csrfToken, type: 'WOONHUIS', connectionCount: '-1', connectionType: '', otherDetails: '' }), false,
    );

    expect(response.statusCode).toBe(400);
    expect(store.upsertLine).not.toHaveBeenCalled();
  });

  it('rejects an otherDetails value far beyond what a medewerker would type, to guard the DynamoDB item size', async () => {
    const store = makeStore();
    store.getWorkVersion.mockResolvedValue({
      caseReference: 'OF-1',
      readableProjectName: '',
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
    });
    const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, makeAuditTrail());

    const response = await handler.handleLineCreate(
      { principalId: 'medewerker' }, 'OF-1', 'wonen', cookieHeader,
      form({ csrfToken, type: 'WOONHUIS', connectionCount: '1', connectionType: '', otherDetails: 'x'.repeat(10_001) }), false,
    );

    expect(response.statusCode).toBe(400);
    expect(store.upsertLine).not.toHaveBeenCalled();
  });

  it('rejects an invalid housing type instead of guessing one', async () => {
    const store = makeStore();
    store.getWorkVersion.mockResolvedValue({
      caseReference: 'OF-1',
      readableProjectName: '',
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
    });
    const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, makeAuditTrail());

    const response = await handler.handleLineCreate(
      { principalId: 'medewerker' }, 'OF-1', 'wonen', cookieHeader,
      form({ csrfToken, type: 'ONBEKEND', connectionCount: '3', connectionType: '', otherDetails: '' }), false,
    );

    expect(response.statusCode).toBe(400);
    expect(store.upsertLine).not.toHaveBeenCalled();
  });

  it('preserves the existing order and homesAccordingToForm on a wonen line update', async () => {
    const store = makeStore();
    store.getWorkVersion.mockResolvedValue({
      caseReference: 'OF-1',
      readableProjectName: '',
      projectDescription: '',
      additionalInformation: '',
      projectWideNotes: '',
      housingLines: {
        'line-1': { lineId: 'line-1', order: 2, type: 'WOONHUIS', connectionCount: 1, connectionType: '3x25A', otherDetails: '', homesAccordingToForm: 10 },
      },
      collectiveFacilityLines: {},
      kovaLines: {},
      createdAt: '',
      createdBy: '',
      updatedAt: '',
      updatedBy: '',
    });
    const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, makeAuditTrail());

    await handler.handleLineUpdate(
      { principalId: 'medewerker' }, 'OF-1', 'wonen', 'line-1', cookieHeader,
      form({ csrfToken, type: 'WOONHUIS', connectionCount: '5', connectionType: 'AC4a', otherDetails: 'gewijzigd' }), false,
    );

    const [, , line, isNew] = store.upsertLine.mock.calls[0];
    expect(isNew).toBe(false);
    expect(line).toMatchObject({ lineId: 'line-1', order: 2, homesAccordingToForm: 10, connectionCount: 5, connectionType: 'AC4a' });
  });

  it('scopes a line update to its own category and preserves multiline free text: a kova update never reads back a wonen line sharing the same lineId', async () => {
    const store = makeStore();
    store.getWorkVersion.mockResolvedValue({
      caseReference: 'OF-1',
      readableProjectName: '',
      projectDescription: '',
      additionalInformation: '',
      projectWideNotes: '',
      housingLines: {
        'shared-id': { lineId: 'shared-id', order: 5, type: 'WOONHUIS', connectionCount: 99, connectionType: 'oud', otherDetails: '', homesAccordingToForm: 3 },
      },
      collectiveFacilityLines: {},
      kovaLines: {},
      createdAt: '',
      createdBy: '',
      updatedAt: '',
      updatedBy: '',
    });
    const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, makeAuditTrail());
    const multilineDetails = 'Warmtepomp\nZonnepanelen: 12 stuks\r\nLaadpaal: 1x 11kW';

    await handler.handleLineUpdate(
      { principalId: 'medewerker' }, 'OF-1', 'kova', 'shared-id', cookieHeader,
      form({ csrfToken, function: 'Nieuwe functie', connectionCount: '2', connectionType: 'nieuw', otherDetails: multilineDetails }), false,
    );

    const [, category, line] = store.upsertLine.mock.calls[0];
    expect(category).toBe('KOVA');
    expect(line).toMatchObject({ lineId: 'shared-id', order: 0, function: 'Nieuwe functie', connectionCount: 2, otherDetails: multilineDetails });
    expect(line).not.toHaveProperty('type');
    expect(line).not.toHaveProperty('homesAccordingToForm');
  });

  it('deletes a line and redirects, auditing category and lineId only', async () => {
    const store = makeStore();
    const auditTrail = makeAuditTrail();
    const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, auditTrail);

    const response = await handler.handleLineDelete({ principalId: 'medewerker' }, 'OF-1', 'kova', 'line-9', cookieHeader, form({ csrfToken }), false);

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toContain('#projectdetails-kova');
    expect(store.deleteLine).toHaveBeenCalledWith('OF-1', 'KOVA', 'line-9', 'medewerker');
    expect((auditTrail.record as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ category: 'KOVA', lineId: 'line-9' }),
    }));
  });

  it('never audits a mutation that the store reports as NOT_FOUND', async () => {
    const store = makeStore();
    store.deleteLine.mockResolvedValue('NOT_FOUND');
    const auditTrail = makeAuditTrail();
    const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, auditTrail);

    await handler.handleLineDelete({ principalId: 'medewerker' }, 'OF-1', 'kova', 'onbekend', cookieHeader, form({ csrfToken }), false);

    expect((auditTrail.record as jest.Mock)).not.toHaveBeenCalled();
  });

  it('an update against an unknown lineId still redirects but audits nothing, since the store reports NOT_FOUND', async () => {
    const store = makeStore();
    store.getWorkVersion.mockResolvedValue({
      caseReference: 'OF-1',
      readableProjectName: '',
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
    });
    store.upsertLine.mockResolvedValue('NOT_FOUND');
    const auditTrail = makeAuditTrail();
    const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, auditTrail);

    const response = await handler.handleLineUpdate(
      { principalId: 'medewerker' }, 'OF-1', 'wonen', 'onbekend', cookieHeader,
      form({ csrfToken, type: 'WOONHUIS', connectionCount: '1', connectionType: '', otherDetails: '' }), false,
    );

    expect(response.statusCode).toBe(303);
    expect((auditTrail.record as jest.Mock)).not.toHaveBeenCalled();
  });

  it('rejects an unknown category path segment', async () => {
    const store = makeStore();
    const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, makeAuditTrail());

    const response = await handler.handleLineDelete({ principalId: 'medewerker' }, 'OF-1', 'onbekend', 'line-1', cookieHeader, form({ csrfToken }), false);

    expect(response.statusCode).toBe(400);
    expect(store.deleteLine).not.toHaveBeenCalled();
  });

  describe('handleLocation', () => {
    it('requires an existing werkversie: a dossier that never had one gets a 404, no store write', async () => {
      const store = makeStore();
      store.getWorkVersion.mockResolvedValue(undefined);
      const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, makeAuditTrail());

      const response = await handler.handleLocation(
        { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ csrfToken, location: VALID_MANUAL_POLYGON_TEXT }), false,
      );

      expect(response.statusCode).toBe(404);
      expect(store.setManualLocation).not.toHaveBeenCalled();
    });

    it('adds a first manual location, audits LOCATION_ADDED and redirects to the location card', async () => {
      const store = makeStore();
      store.getWorkVersion.mockResolvedValue(readyWorkVersion());
      const auditTrail = makeAuditTrail();
      const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, auditTrail);

      const response = await handler.handleLocation(
        { principalId: 'medewerker', email: 'medewerker@example.nl' }, 'OF-1', cookieHeader,
        form({ csrfToken, location: VALID_MANUAL_POLYGON_TEXT }), false,
      );

      expect(response.statusCode).toBe(303);
      expect(response.headers?.Location).toContain('#pd-project-location-card');
      const [, polygon, isNew, actor] = store.setManualLocation.mock.calls[0];
      expect(isNew).toBe(true);
      expect(actor).toBe('medewerker@example.nl');
      expect(polygon).toMatchObject({ type: 'Polygon' });
      expect((auditTrail.record as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ caseReference: 'OF-1', changeAction: 'LOCATION_ADDED' }),
      }));
    });

    it('replaces an existing manual location and audits LOCATION_REPLACED, not LOCATION_ADDED', async () => {
      const store = makeStore();
      store.getWorkVersion.mockResolvedValue(readyWorkVersion({
        manualLocationPolygon: { type: 'Polygon', coordinates: [[[5.86, 51.85], [5.87, 51.85], [5.87, 51.86], [5.86, 51.85]]] },
      } as never));
      const auditTrail = makeAuditTrail();
      const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, auditTrail);

      await handler.handleLocation(
        { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ csrfToken, location: VALID_MANUAL_POLYGON_TEXT }), false,
      );

      const [, , isNew] = store.setManualLocation.mock.calls[0];
      expect(isNew).toBe(false);
      expect((auditTrail.record as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ changeAction: 'LOCATION_REPLACED' }),
      }));
    });

    it('rejects a three-feature export instead of guessing which vlak is meant, and writes nothing', async () => {
      const store = makeStore();
      store.getWorkVersion.mockResolvedValue(readyWorkVersion());
      const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, makeAuditTrail());
      const threeFeatures = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[5.8, 51.8], [5.9, 51.8], [5.9, 51.9], [5.8, 51.9], [5.8, 51.8]]] } },
          { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[5.86, 51.85], [5.86, 51.85], [5.86, 51.85], [5.86, 51.85]]] } },
          { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[5.861824, 51.8464654], [5.8623068, 51.8464787], [5.8622317, 51.8462732], [5.861824, 51.8464654]]] } },
        ],
      });

      const response = await handler.handleLocation(
        { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ csrfToken, location: threeFeatures }), false,
      );

      expect(response.statusCode).toBe(303);
      expect(response.headers?.Location).toContain('locationError=MULTIPLE_FEATURES');
      expect(store.setManualLocation).not.toHaveBeenCalled();
    });

    it('rejects a self-intersecting bow-tie polygon, leaving any previous polygon untouched', async () => {
      const store = makeStore();
      store.getWorkVersion.mockResolvedValue(readyWorkVersion());
      const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, makeAuditTrail());
      const bowtie = JSON.stringify({ type: 'Polygon', coordinates: [[[5.85, 51.85], [5.86, 51.86], [5.86, 51.85], [5.85, 51.86], [5.85, 51.85]]] });

      const response = await handler.handleLocation(
        { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ csrfToken, location: bowtie }), false,
      );

      expect(response.statusCode).toBe(303);
      expect(response.headers?.Location).toContain('locationError=SELF_INTERSECTING');
      expect(store.setManualLocation).not.toHaveBeenCalled();
    });

    it('never audits when the store reports NOT_FOUND (werkversie disappeared between read and write)', async () => {
      const store = makeStore();
      store.getWorkVersion.mockResolvedValue(readyWorkVersion());
      store.setManualLocation.mockResolvedValue('NOT_FOUND');
      const auditTrail = makeAuditTrail();
      const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, auditTrail);

      await handler.handleLocation(
        { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ csrfToken, location: VALID_MANUAL_POLYGON_TEXT }), false,
      );

      expect((auditTrail.record as jest.Mock)).not.toHaveBeenCalled();
    });

    it('denies a view-only medewerker (no manage permission), never reaching parseManualLocation or the store', async () => {
      const authorizationService = {
        loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'medewerker' } }),
        requireAuthorization: jest.fn().mockResolvedValue({ statusCode: 403 }),
        denyAccess: jest.fn().mockResolvedValue({ statusCode: 403 }),
      } as unknown as AuthorizationService;
      const store = makeStore();
      const handler = new ProjectDetailsActionHandler(authorizationService, store as unknown as ProjectDetailsStore, makeAuditTrail());

      const response = await handler.handleLocation(
        { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ csrfToken, location: VALID_MANUAL_POLYGON_TEXT }), false,
      );

      expect(response.statusCode).toBe(403);
      expect(store.getWorkVersion).not.toHaveBeenCalled();
      expect(store.setManualLocation).not.toHaveBeenCalled();
    });

    it('denies a POST with a missing or wrong CSRF token', async () => {
      const store = makeStore();
      const handler = new ProjectDetailsActionHandler(makeAuthorizationService(), store as unknown as ProjectDetailsStore, makeAuditTrail());

      const response = await handler.handleLocation(
        { principalId: 'medewerker' }, 'OF-1', cookieHeader, form({ csrfToken: 'wrong-token', location: VALID_MANUAL_POLYGON_TEXT }), false,
      );

      expect(response.statusCode).toBe(403);
      expect(store.setManualLocation).not.toHaveBeenCalled();
    });
  });
});
