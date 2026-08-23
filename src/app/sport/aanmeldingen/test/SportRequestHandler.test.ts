import { FakeAuditTrail } from '../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../../shared/authorization/tests/FakePermissionRepository';
import { SportRequestHandler } from '../SportRequestHandler';

describe('SportRequestHandler', () => {
  it('denies a medewerker without any Sport grant', async () => {
    const auditTrail = new FakeAuditTrail();
    const service = new AuthorizationService(new FakePermissionRepository(), auditTrail);
    const handler = new SportRequestHandler(service);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });

    expect(response.statusCode).toBe(403);
    expect(auditTrail.events.map((event) => event.eventType)).not.toContain('ACCESS_GRANTED');
  });

  it('records an ACCESS_GRANTED audit event and renders the shell without fetching any submissions', async () => {
    const auditTrail = new FakeAuditTrail();
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }]);
    const service = new AuthorizationService(repository, auditTrail);
    const handler = new SportRequestHandler(service);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });
    const body = response.body ?? '';

    expect(response.statusCode).toBe(200);
    expect(auditTrail.events).toContainEqual(expect.objectContaining({
      eventType: 'ACCESS_GRANTED', outcome: 'SUCCESS', resource: 'sport', action: 'view', actorEmail: 'medewerker@nijmegen.nl',
    }));
    // Shell only: spinner container and refresh button, no live-fetched record markup.
    expect(body).toContain('id="sport-submissions"');
    expect(body).toContain('id="sport-refresh-button"');
    expect(body).not.toContain('sport-record__summary');
  });

  it('shows the district-scoped visible-period text for a medewerker with limited districts', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }]);
    const service = new AuthorizationService(repository, new FakeAuditTrail());
    const handler = new SportRequestHandler(service);

    const response = await handler.handleRequest({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });
    const body = response.body ?? '';

    expect(body).toContain('Je ziet aanmeldingen vanaf');
    expect(body).toContain('Dukenburg');
    expect(body).not.toContain('uit alle wijken');
  });

  it('shows the "alle wijken" summary for a global admin instead of listing every district', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('admin@nijmegen.nl', [{ resource: '*', actions: ['*'] }]);
    const service = new AuthorizationService(repository, new FakeAuditTrail());
    const handler = new SportRequestHandler(service);

    const response = await handler.handleRequest({ principalId: 'admin-1', email: 'admin@nijmegen.nl' });
    const body = response.body ?? '';

    expect(body).toContain('uit alle wijken');
  });

  it('reflects an explicit filter selection in the rendered checkbox state', async () => {
    const repository = new FakePermissionRepository();
    repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg', 'lindenholt'] } }]);
    const service = new AuthorizationService(repository, new FakeAuditTrail());
    const handler = new SportRequestHandler(service);

    const response = await handler.handleRequest(
      { principalId: 'employee-1', email: 'medewerker@nijmegen.nl' },
      { filterSubmitted: '1', district: 'dukenburg', type: 'kind' },
    );
    const body = response.body ?? '';

    expect(body).toContain('id="district-dukenburg" name="district" value="dukenburg" checked');
    expect(body).not.toContain('id="district-lindenholt" name="district" value="lindenholt" checked');
  });
});
