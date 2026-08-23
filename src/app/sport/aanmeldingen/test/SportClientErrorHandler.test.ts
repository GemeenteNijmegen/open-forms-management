import { logger } from '../../../../observability/Logger';
import { FakeAuditTrail } from '../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../../shared/authorization/tests/FakePermissionRepository';
import { SPORT_SAME_ORIGIN_HEADER } from '../../../../shared/security/SameOriginRequest';
import { SportClientErrorHandler } from '../SportClientErrorHandler';

function authorizedService(): AuthorizationService {
  const repository = new FakePermissionRepository();
  repository.seedGrants('medewerker@nijmegen.nl', [{ resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } }]);
  return new AuthorizationService(repository, new FakeAuditTrail());
}

const identity = { principalId: 'employee-1', email: 'medewerker@nijmegen.nl' };
const sameOriginHeaders = { [SPORT_SAME_ORIGIN_HEADER]: '1' };

describe('SportClientErrorHandler', () => {
  beforeEach(() => {
    jest.spyOn(logger, 'warn').mockImplementation(() => { });
  });

  it('denies a medewerker without any Sport grant', async () => {
    const service = new AuthorizationService(new FakePermissionRepository(), new FakeAuditTrail());
    const handler = new SportClientErrorHandler(service);

    const response = await handler.handleRequest(identity, sameOriginHeaders, JSON.stringify({ event: 'REFRESH_FAILED' }), false);

    expect(response.statusCode).toBe(403);
  });

  it('rejects a POST missing the same-origin header', async () => {
    const handler = new SportClientErrorHandler(authorizedService());

    const response = await handler.handleRequest(identity, {}, JSON.stringify({ event: 'REFRESH_FAILED' }), false);

    expect(response.statusCode).toBe(403);
  });

  it('accepts an allowlisted event with a technical relatedCorrelationId and logs it as WARN', async () => {
    const handler = new SportClientErrorHandler(authorizedService());

    const response = await handler.handleRequest(
      identity, sameOriginHeaders, JSON.stringify({ event: 'LOAD_MORE_FAILED', relatedCorrelationId: '1-5e1b4151-5ac6c58e2f1c2a1c9a4e0f0e' }), false,
    );

    expect(response.statusCode).toBe(202);
    expect(logger.warn).toHaveBeenCalledWith('Sport client error reported', {
      event: 'LOAD_MORE_FAILED', relatedCorrelationId: '1-5e1b4151-5ac6c58e2f1c2a1c9a4e0f0e',
    });
  });

  it('rejects an event name outside the allowlist, without logging it', async () => {
    const handler = new SportClientErrorHandler(authorizedService());

    const response = await handler.handleRequest(identity, sameOriginHeaders, JSON.stringify({ event: 'SOMETHING_ELSE' }), false);

    expect(response.statusCode).toBe(400);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('drops free text instead of a technical correlation id, and ignores malformed JSON without crashing', async () => {
    const handler = new SportClientErrorHandler(authorizedService());

    const withFreeText = await handler.handleRequest(
      identity, sameOriginHeaders,
      JSON.stringify({ event: 'INITIAL_LOAD_FAILED', relatedCorrelationId: 'unrelated free text with spaces and punctuation!' }),
      false,
    );
    expect(withFreeText.statusCode).toBe(202);
    expect(logger.warn).toHaveBeenCalledWith('Sport client error reported', { event: 'INITIAL_LOAD_FAILED' });

    const malformed = await handler.handleRequest(identity, sameOriginHeaders, '{not json', false);
    expect(malformed.statusCode).toBe(400);
  });

  it('decodes a base64-encoded body the same way as a plain one', async () => {
    const handler = new SportClientErrorHandler(authorizedService());
    const body = Buffer.from(JSON.stringify({ event: 'UNHANDLED_PROMISE_REJECTION' })).toString('base64');

    const response = await handler.handleRequest(identity, sameOriginHeaders, body, true);

    expect(response.statusCode).toBe(202);
  });
});
