import { FakeAuditTrail } from '../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../shared/authorization/tests/FakePermissionRepository';
import { HomeRequestHandler } from '../HomeRequestHandler';

describe('HomeRequestHandler', () => {
  it('renders the actor email and a 200 response for a medewerker without any grants', async () => {
    const service = new AuthorizationService(new FakePermissionRepository(), new FakeAuditTrail());
    const handler = new HomeRequestHandler(service);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, '/');

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Welkom, medewerker@nijmegen.nl');
  });

  // Subproject 1 has no registered features yet, so even a global admin sees the empty state: there is
  // nothing to be admin of until subproject 2 registers a real feature.
  it('shows the empty state for a global admin too, since no features are registered yet', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('admin@nijmegen.nl', [{ resource: '*', actions: ['*'] }]);
    const service = new AuthorizationService(repository, new FakeAuditTrail());
    const handler = new HomeRequestHandler(service);

    const response = await handler.handleRequest({ principalId: 'admin-1', email: 'admin@nijmegen.nl' }, '/');

    expect(response.body).toContain('Er zijn nog geen onderdelen beschikbaar');
  });

  it('renders without an actor line when the identity has no email', async () => {
    const service = new AuthorizationService(new FakePermissionRepository(), new FakeAuditTrail());
    const handler = new HomeRequestHandler(service);

    const response = await handler.handleRequest({ principalId: 'employee-1' }, '/');

    expect(response.body).not.toContain('Welkom,');
    expect(response.body).toContain('Welkom<');
  });

  it('renders a 404 page for any path other than /', async () => {
    const service = new AuthorizationService(new FakePermissionRepository(), new FakeAuditTrail());
    const handler = new HomeRequestHandler(service);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, '/unknown-path');

    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('Pagina niet gevonden');
  });
});
