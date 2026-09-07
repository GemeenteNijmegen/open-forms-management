import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../../shared/authorization/PermissionEvaluator';
import { AdditionalEvidenceOverviewHandler } from '../AdditionalEvidenceOverviewHandler';

function makeAuthorizationService(grants: { resource: string; actions: string[] }[]): AuthorizationService {
  const evaluator = new PermissionEvaluator(grants);
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'employee-1' }, evaluator }),
    requireAuthorization: jest.fn().mockImplementation(async (context, check) => (evaluator.evaluate(check) === 'ALLOW'
      ? undefined
      : { statusCode: 403 })),
  } as unknown as AuthorizationService;
}

describe('AdditionalEvidenceOverviewHandler', () => {
  it('renders the Extra bewijzen tab as active for a medewerker with woonbehoefte:view', async () => {
    const handler = new AdditionalEvidenceOverviewHandler(makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['view'] }]));

    const response = await handler.handleRequest({ principalId: 'employee-1' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('woonbehoefte-tabs__link--active');
    expect(response.body).toContain('Extra bewijzen');
  });

  it('denies a medewerker without woonbehoefte:view', async () => {
    const handler = new AdditionalEvidenceOverviewHandler(makeAuthorizationService([]));

    const response = await handler.handleRequest({ principalId: 'employee-2' });

    expect(response.statusCode).toBe(403);
  });
});
