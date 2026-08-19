import { FakePermissionRepository } from './FakePermissionRepository';
import { FakeAuditTrail } from '../../audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../AuthorizationService';

describe('AuthorizationService', () => {
  describe('loadContext', () => {
    it('loads grants for the identity email and builds an evaluator over them', async () => {
      const repository = new FakePermissionRepository();
      repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'testresource', actions: ['view'] }]);
      const service = new AuthorizationService(repository, new FakeAuditTrail());

      const context = await service.loadContext({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });

      expect(context.identity).toEqual({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });
      expect(context.evaluator.evaluate({ resource: 'testresource', action: 'view' })).toBe('ALLOW');
      expect(context.evaluator.evaluate({ resource: 'testresource', action: 'delete' })).toBe('DENY');
    });

    it('builds an evaluator with no grants when the identity has no email, without querying the repository', async () => {
      const repository = new FakePermissionRepository();
      const getGrantsSpy = jest.spyOn(repository, 'getGrants');
      const service = new AuthorizationService(repository, new FakeAuditTrail());

      const context = await service.loadContext({ principalId: 'employee-1' });

      expect(getGrantsSpy).not.toHaveBeenCalled();
      expect(context.evaluator.evaluate({ resource: 'testresource', action: 'view' })).toBe('DENY');
    });
  });

  describe('requireAuthorization', () => {
    it('returns undefined so the handler can proceed when the check is allowed', async () => {
      const repository = new FakePermissionRepository();
      repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'testresource', actions: ['view'] }]);
      const service = new AuthorizationService(repository, new FakeAuditTrail());
      const context = await service.loadContext({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });

      const response = await service.requireAuthorization(context, { resource: 'testresource', action: 'view' });

      expect(response).toBeUndefined();
    });

    it('returns a 403 response when the check is denied', async () => {
      const repository = new FakePermissionRepository();
      const service = new AuthorizationService(repository, new FakeAuditTrail());
      const context = await service.loadContext({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });

      const response = await service.requireAuthorization(context, { resource: 'testresource', action: 'view' });

      expect(response?.statusCode).toBe(403);
    });

    it('allows any resource and action for a global admin grant, without the caller writing wildcard logic', async () => {
      const repository = new FakePermissionRepository();
      repository.seedGrants('admin@nijmegen.nl', [{ resource: '*', actions: ['*'] }]);
      const service = new AuthorizationService(repository, new FakeAuditTrail());
      const context = await service.loadContext({ principalId: 'admin-1', email: 'admin@nijmegen.nl' });

      const response = await service.requireAuthorization(context, { resource: 'anything', action: 'anything' });

      expect(response).toBeUndefined();
    });

    it('records an ACCESS_DENIED audit event with the resource, action and actor when denied', async () => {
      const repository = new FakePermissionRepository();
      const auditTrail = new FakeAuditTrail();
      const service = new AuthorizationService(repository, auditTrail);
      const context = await service.loadContext({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });

      await service.requireAuthorization(context, { resource: 'testresource', action: 'view' });

      expect(auditTrail.events).toEqual([{
        eventId: expect.any(String),
        occurredAt: expect.any(String),
        eventType: 'ACCESS_DENIED',
        outcome: 'DENIED',
        correlationId: expect.any(String),
        resource: 'testresource',
        action: 'view',
        actorEmail: 'medewerker@nijmegen.nl',
      }]);
    });

    it('records no audit event when the check is allowed', async () => {
      const repository = new FakePermissionRepository();
      repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'testresource', actions: ['view'] }]);
      const auditTrail = new FakeAuditTrail();
      const service = new AuthorizationService(repository, auditTrail);
      const context = await service.loadContext({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });

      await service.requireAuthorization(context, { resource: 'testresource', action: 'view' });

      expect(auditTrail.events).toEqual([]);
    });
  });
});
