import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../../shared/authorization/PermissionEvaluator';
import { ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION, AdditionalEvidenceSourceFailure, AdditionalEvidenceSourceRecord } from '../../domain/AdditionalEvidenceSource';
import { AdditionalEvidenceRepository, AdditionalEvidenceWorkItem } from '../../persistence/AdditionalEvidenceRepository';
import { AdditionalEvidenceSourceCacheStore } from '../../source/AdditionalEvidenceSourceCacheStore';
import { AdditionalEvidenceOverviewHandler } from '../AdditionalEvidenceOverviewHandler';

function makeAuthorizationService(grants: { resource: string; actions: string[] }[]): AuthorizationService {
  const evaluator = new PermissionEvaluator(grants);
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'employee-1' }, evaluator }),
    requireAuthorization: jest.fn().mockImplementation(async (_context, check) => (evaluator.evaluate(check) === 'ALLOW'
      ? undefined
      : { statusCode: 403 })),
  } as unknown as AuthorizationService;
}

function makeRepository(workItems: AdditionalEvidenceWorkItem[]): AdditionalEvidenceRepository {
  return { listWorkItems: jest.fn().mockResolvedValue(workItems) } as unknown as AdditionalEvidenceRepository;
}

function makeSourceCacheStore(
  submissions: AdditionalEvidenceSourceRecord[] = [], failedMarkers: AdditionalEvidenceSourceFailure[] = [],
): AdditionalEvidenceSourceCacheStore {
  return {
    readReadySubmissions: jest.fn().mockResolvedValue({ submissions, failedMarkers }),
    getState: jest.fn().mockResolvedValue(undefined),
  } as unknown as AdditionalEvidenceSourceCacheStore;
}

function workItem(overrides: Partial<AdditionalEvidenceWorkItem> = {}): AdditionalEvidenceWorkItem {
  return {
    objectUuid: 'uuid-1',
    submissionReference: 'OF-EXTRA01',
    status: 'NEW',
    createdAt: '2026-09-07T18:00:00.000Z',
    createdBy: 'additional-evidence-sync-worker',
    ...overrides,
  };
}

function sourceRecord(overrides: Partial<AdditionalEvidenceSourceRecord> & { objectUuid: string }): AdditionalEvidenceSourceRecord {
  return {
    status: 'READY',
    cacheVersion: ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION,
    submissionId: overrides.objectUuid,
    reference: 'OF-EXTRA01',
    formName: 'Extra bewijzen stroomaansluiting woningbouw',
    submittedAt: '2026-09-07T17:54:04.702Z',
    originalCaseReference: 'OF-HOOFD01',
    attachments: [],
    cachedAt: '2026-09-07T18:00:00.000Z',
    ...overrides,
  };
}

describe('AdditionalEvidenceOverviewHandler', () => {
  it('renders the Extra bewijzen tab as active and an empty state for a medewerker with woonbehoefte:view', async () => {
    const handler = new AdditionalEvidenceOverviewHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['view'] }]), makeRepository([]), makeSourceCacheStore(),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('woonbehoefte-tabs__link--active');
    expect(response.body).toContain('Er zijn geen extra bewijzen die aan het huidige filter voldoen.');
  });

  it('joins a workitem with its current source record: projectnaam, opgegeven hoofdzaak en status zichtbaar', async () => {
    const handler = new AdditionalEvidenceOverviewHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['view'] }]),
      makeRepository([workItem()]),
      makeSourceCacheStore([sourceRecord({ objectUuid: 'uuid-1', submittedProjectName: 'Project Lindenhof' })]),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.body).toContain('Project Lindenhof');
    expect(response.body).toContain('OF-EXTRA01');
    expect(response.body).toContain('OF-HOOFD01');
    expect(response.body).toContain('Nieuw');
  });

  it('shows a technical bronfout warning, not a workflow status, when the source failed to read', async () => {
    const handler = new AdditionalEvidenceOverviewHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['view'] }]),
      makeRepository([workItem()]),
      makeSourceCacheStore([], [{
        status: 'FAILED', objectUuid: 'uuid-1', failureReasonCode: 'CSV_FETCH_ERROR', lastAttemptAt: '2026-09-07T18:05:00.000Z',
      }]),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.body).toContain('brongegevens van deze inzending konden niet volledig worden gelezen');
    // Status label stays the workitem's own status ("Nieuw"), never a source-error pseudo-status.
    expect(response.body).toContain('Nieuw');
    expect(response.body).toContain('Onbekend project (bron nog niet beschikbaar)');
  });

  it('still shows a LINKED workitem in the same werkvoorraad, not hidden by default', async () => {
    const handler = new AdditionalEvidenceOverviewHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['view'] }]),
      makeRepository([workItem({ status: 'LINKED' })]),
      makeSourceCacheStore([sourceRecord({ objectUuid: 'uuid-1' })]),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.body).toContain('Gekoppeld');
  });

  it('filters to only the requested statuses', async () => {
    const handler = new AdditionalEvidenceOverviewHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['view'] }]),
      makeRepository([workItem({ objectUuid: 'uuid-1', status: 'NEW' }), workItem({ objectUuid: 'uuid-2', status: 'LINKED' })]),
      makeSourceCacheStore([sourceRecord({ objectUuid: 'uuid-1' }), sourceRecord({ objectUuid: 'uuid-2' })]),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, { status: 'LINKED' });

    expect(response.body).toContain('1 extra bewijs');
    expect(response.body).toContain('Gekoppeld');
  });

  it('filters op zoekterm, matcht op projectnaam, opgegeven hoofdzaakkenmerk en de eigen extra-bewijzenreferentie', async () => {
    const handler = new AdditionalEvidenceOverviewHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['view'] }]),
      makeRepository([
        workItem({ objectUuid: 'uuid-1', submissionReference: 'OF-EXTRA01' }),
        workItem({ objectUuid: 'uuid-2', submissionReference: 'OF-EXTRA02' }),
      ]),
      makeSourceCacheStore([
        sourceRecord({ objectUuid: 'uuid-1', submittedProjectName: 'Project Lindenhof', originalCaseReference: 'OF-HOOFD01' }),
        sourceRecord({ objectUuid: 'uuid-2', submittedProjectName: 'Project Meijhorst', originalCaseReference: 'OF-HOOFD02' }),
      ]),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, { search: 'lindenhof' });

    expect(response.body).toContain('1 extra bewijs');
    expect(response.body).toContain('Project Lindenhof');
    expect(response.body).not.toContain('Project Meijhorst');
    // De ingevulde zoekterm blijft zichtbaar in het zoekveld.
    expect(response.body).toContain('value="lindenhof"');
  });

  it('denies a medewerker without woonbehoefte:view', async () => {
    const handler = new AdditionalEvidenceOverviewHandler(makeAuthorizationService([]), makeRepository([]), makeSourceCacheStore());

    const response = await handler.handleRequest({ principalId: 'employee-2' }, undefined);

    expect(response.statusCode).toBe(403);
  });
});
