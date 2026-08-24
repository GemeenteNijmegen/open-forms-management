import { FakeAuditTrail } from '../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../shared/authorization/tests/FakePermissionRepository';
import { HomeRequestHandler } from '../HomeRequestHandler';

describe('HomeRequestHandler', () => {
  it('renders the actor email and a 200 response for a medewerker with a feature grant', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'] }]);
    const service = new AuthorizationService(repository, new FakeAuditTrail());
    const handler = new HomeRequestHandler(service);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, '/');

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Welkom, medewerker@nijmegen.nl');
  });

  // No distinction is shown between "no subject record" and "subject without grants" - both a medewerker with
  // zero grants and one with none at all land here identically.
  it('shows a dedicated no-permissions page instead of an empty Home for a medewerker without any usable grants', async () => {
    const service = new AuthorizationService(new FakePermissionRepository(), new FakeAuditTrail());
    const handler = new HomeRequestHandler(service);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, '/');

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Geen toegang');
    expect(response.body).not.toContain('Welkom');
  });

  it('shows the Sport feature in the sidenav for a global admin', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('admin@nijmegen.nl', [{ resource: '*', actions: ['*'] }]);
    const service = new AuthorizationService(repository, new FakeAuditTrail());
    const handler = new HomeRequestHandler(service);

    const response = await handler.handleRequest({ principalId: 'admin-1', email: 'admin@nijmegen.nl' }, '/');

    expect(response.body).toContain('Sport');
  });

  it('shows "Gebruikers" in the sidenav for a global admin, but not for a regular sport user', async () => {
    const adminRepository = new FakePermissionRepository();
    adminRepository.seedGrants('admin@nijmegen.nl', [{ resource: '*', actions: ['*'] }]);
    const adminHandler = new HomeRequestHandler(new AuthorizationService(adminRepository, new FakeAuditTrail()));
    const adminResponse = await adminHandler.handleRequest({ principalId: 'admin-1', email: 'admin@nijmegen.nl' }, '/');
    expect(adminResponse.body).toContain('Gebruikers');

    const sportUserRepository = new FakePermissionRepository();
    sportUserRepository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'] }]);
    const sportUserHandler = new HomeRequestHandler(new AuthorizationService(sportUserRepository, new FakeAuditTrail()));
    const sportUserResponse = await sportUserHandler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, '/');
    expect(sportUserResponse.body).not.toContain('Gebruikers');
  });

  it('renders without an actor line when the identity has no email', async () => {
    const repository = new FakePermissionRepository();
    const service = new AuthorizationService(repository, new FakeAuditTrail());
    const handler = new HomeRequestHandler(service);

    // No email at all: loadContext() returns an evaluator with no grants without even querying the repository,
    // so this medewerker would land on the no-permissions page regardless of any seeded grants for other emails.
    // The point here is specifically the header rendering when actorEmail is absent, so assert on that page instead.
    const response = await handler.handleRequest({ principalId: 'employee-1' }, '/');

    expect(response.body).not.toContain('Welkom,');
    expect(response.body).toContain('Geen toegang');
  });

  it('renders a 404 page for any path other than /', async () => {
    const service = new AuthorizationService(new FakePermissionRepository(), new FakeAuditTrail());
    const handler = new HomeRequestHandler(service);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' }, '/unknown-path');

    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('Pagina niet gevonden');
  });
});
