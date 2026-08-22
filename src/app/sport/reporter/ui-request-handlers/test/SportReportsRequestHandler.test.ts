import { FakeAuditTrail } from '../../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../../../shared/authorization/tests/FakePermissionRepository';
import { SportReportStore } from '../../store/SportReportStore';
import { SportReportsRequestHandler } from '../SportReportsRequestHandler';

describe('SportReportsRequestHandler', () => {
  it('denies a medewerker without Sport access', async () => {
    const service = new AuthorizationService(new FakePermissionRepository(), new FakeAuditTrail());
    const store = { listRecent: jest.fn() } as unknown as SportReportStore;
    const handler = new SportReportsRequestHandler(service, store);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, undefined);

    expect(response.statusCode).toBe(403);
  });

  it('renders the reporter page with the season-start default and today, and maps a status flash message', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }]);
    const service = new AuthorizationService(repository, new FakeAuditTrail());
    const store = { listRecent: jest.fn().mockResolvedValue([]) } as unknown as SportReportStore;
    const handler = new SportReportsRequestHandler(service, store);

    const response = await handler.handleRequest(
      { principalId: 'employee-1', email: 'medewerker@nijmegen.nl' },
      { status: 'queued' },
    );
    const body = response.body ?? '';

    expect(response.statusCode).toBe(200);
    expect(body).toContain('Het Excel-overzicht wordt op de achtergrond gemaakt');
    expect(body).toContain('Excel-overzichten');
  });
});
