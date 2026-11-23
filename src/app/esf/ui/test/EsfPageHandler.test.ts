import { FakeAuditTrail } from '../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../../shared/authorization/tests/FakePermissionRepository';
import { EsfPageHandler } from '../EsfPageHandler';

const identity = { principalId: 'employee-1', email: 'medewerker@nijmegen.nl' };

function handlerWithGrants(grants: { resource: string; actions: string[] }[], auditTrail = new FakeAuditTrail()): EsfPageHandler {
  const repository = new FakePermissionRepository();
  repository.seedGrants(identity.email, grants);
  return new EsfPageHandler(new AuthorizationService(repository, auditTrail));
}

describe('EsfPageHandler', () => {
  it.each([
    ['esf:view', [{ resource: 'esf', actions: ['view'] }]],
    ['global admin', [{ resource: '*', actions: ['*'] }]],
  ])('shows the search form with a CSRF token for %s', async (_label, grants) => {
    const response = await handlerWithGrants(grants).handleRequest(identity);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('action="/esf/zoeken"');
    expect(response.body).toMatch(/name="csrfToken" value="[^"]+"/);
    expect(response.cookies?.[0]).toContain('__Host-csrf=');
  });

  it('denies a medewerker with only sport and woonbehoefte rights', async () => {
    const auditTrail = new FakeAuditTrail();
    const handler = handlerWithGrants([{ resource: 'sport', actions: ['view'] }, { resource: 'woonbehoefte', actions: ['view'] }], auditTrail);

    const response = await handler.handleRequest(identity);

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('/esf/zoeken');
    expect(auditTrail.events).toEqual([expect.objectContaining({ eventType: 'ACCESS_DENIED', resource: 'esf', action: 'view' })]);
  });
});
