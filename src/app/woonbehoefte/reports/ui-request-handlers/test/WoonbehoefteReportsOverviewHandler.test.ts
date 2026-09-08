import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../../shared/authorization/PermissionEvaluator';
import { WoonbehoefteReportsOverviewHandler } from '../WoonbehoefteReportsOverviewHandler';

function makeAuthorizationService(grants: { resource: string; actions: string[] }[]): AuthorizationService {
  const evaluator = new PermissionEvaluator(grants);
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'employee-1' }, evaluator }),
    requireAuthorization: jest.fn().mockImplementation(async (_context, check) => (evaluator.evaluate(check) === 'ALLOW'
      ? undefined
      : { statusCode: 403 })),
  } as unknown as AuthorizationService;
}

describe('WoonbehoefteReportsOverviewHandler', () => {
  it('denies a medewerker without woonbehoefte:exceloverzicht', async () => {
    const handler = new WoonbehoefteReportsOverviewHandler(makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['view'] }]));

    const response = await handler.handleRequest({ principalId: 'employee-1' });

    expect(response.statusCode).toBe(403);
  });

  it('renders the Excel-overzichten tab as active for a medewerker with only woonbehoefte:exceloverzicht', async () => {
    const handler = new WoonbehoefteReportsOverviewHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['exceloverzicht'] }]),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('woonbehoefte-tabs__link--active');
    // Excel-only: no Aanvragen/Extra bewijzen tabs, only Excel-overzichten itself.
    expect(response.body).not.toContain('Aanvragen</a>');
    expect(response.body).toContain('Er zijn nog geen Excel-overzichten.');
  });

  it('also shows Aanvragen and Extra bewijzen for a medewerker with both woonbehoefte:view and woonbehoefte:exceloverzicht', async () => {
    const handler = new WoonbehoefteReportsOverviewHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['view', 'exceloverzicht'] }]),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' });

    expect(response.body).toContain('Aanvragen</a>');
    expect(response.body).toContain('Extra bewijzen</a>');
  });
});
