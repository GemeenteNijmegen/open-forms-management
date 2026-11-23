import { logger } from '../../../../observability/Logger';
import { RecordAuditEventInput } from '../../../../shared/audit/AuditEvent';
import { FakeAuditTrail } from '../../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../../../shared/authorization/tests/FakePermissionRepository';
import { HttpClientError } from '../../../../shared/clients/http/HttpClientError';
import { EsfSearchResult, EsfSearchService } from '../../data/EsfSearchService';
import { EsfSearchHandler } from '../EsfSearchHandler';

const identity = { principalId: 'employee-1', email: 'medewerker@nijmegen.nl' };
const CSRF = 'test-csrf-token';
const COOKIE = `__Host-csrf=${CSRF}`;
const NUMMER = '100000001';

function body(fields: Record<string, string>): string {
  return new URLSearchParams({ csrfToken: CSRF, periodenummer: '202610', zoeksoort: 'clientnummer', zoekwaarde: NUMMER, ...fields }).toString();
}

function setup(search: () => Promise<EsfSearchResult>, auditTrail = new FakeAuditTrail()) {
  const repository = new FakePermissionRepository();
  repository.seedGrants(identity.email, [{ resource: 'esf', actions: ['view'] }]);
  const searchMock = jest.fn(search);
  const handler = new EsfSearchHandler(
    new AuthorizationService(repository, auditTrail), auditTrail, async () => ({ search: searchMock }) as unknown as EsfSearchService,
  );
  return { handler, searchMock, auditTrail };
}

describe('EsfSearchHandler', () => {
  let logs: unknown[];

  beforeEach(() => {
    logs = [];
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      jest.spyOn(logger, level).mockImplementation((...args: unknown[]) => { logs.push(args); });
    }
  });

  it('shows all tasks with no-store and keeps the number out of logs and audit', async () => {
    const { handler, auditTrail } = setup(async () => ({
      outcome: 'FOUND',
      tasks: [{
        objectUuid: '11111111-1111-4111-8111-111111111111',
        periodenummer: '202610',
        clientnummer: NUMMER,
        dossiernummer: '90000001',
        records: [
          { index: 1, status: 'open', registrationAt: '2026-10-02' }, { index: 2, status: 'open', registrationAt: '2026-10-05' },
        ],
      }],
    }));

    const response = await handler.handleRequest(identity, COOKIE, body({}), false);

    expect(response.statusCode).toBe(200);
    expect(response.headers?.['Cache-Control']).toBe('private, no-store');
    expect(response.body).toContain('Periode 202610: 1 ESF-taak gevonden');
    expect(response.body.match(/<td>open<\/td>/g)).toHaveLength(2);
    expect(auditTrail.events.map((event) => event.eventType)).toEqual(['ESF_SEARCH_STARTED', 'ESF_SEARCH_FINISHED']);
    expect(JSON.stringify(auditTrail.events)).not.toContain(NUMMER);
    expect(JSON.stringify(logs)).not.toContain(NUMMER);
  });

  it.each([
    ['an invalid CSRF token', 'other-cookie=1', body({}), 403],
    ['an invalid period', COOKIE, body({ periodenummer: '202613' }), 400],
    ['a number with a double underscore', COOKIE, body({ zoekwaarde: '12__34' }), 400],
  ])('does not call Objects for %s', async (_label, cookie, requestBody, status) => {
    const { handler, searchMock, auditTrail } = setup(async () => ({ outcome: 'NOT_FOUND' }));

    const response = await handler.handleRequest(identity, cookie, requestBody, false);

    expect(response.statusCode).toBe(status);
    expect(searchMock).not.toHaveBeenCalled();
    expect(auditTrail.events.some((event) => event.eventType === 'ESF_SEARCH_STARTED')).toBe(false);
  });

  it('passes a number with a hyphen and leading zeros as a string', async () => {
    const { handler, searchMock } = setup(async () => ({ outcome: 'NOT_FOUND' }));

    const response = await handler.handleRequest(identity, COOKIE, body({ zoeksoort: 'dossiernummer', zoekwaarde: '007-test-1' }), false);

    expect(response.statusCode).toBe(200);
    expect(searchMock).toHaveBeenCalledWith({ periodenummer: '202610', searchType: 'dossiernummer', searchValue: '007-test-1' });
  });

  it('does not call Objects when the audit start cannot be written', async () => {
    const auditTrail = new FakeAuditTrail();
    jest.spyOn(auditTrail, 'record').mockImplementation(async (input: RecordAuditEventInput) => {
      if (input.eventType === 'ESF_SEARCH_STARTED') {
        throw new Error('DynamoDB unavailable');
      }
    });
    const { handler, searchMock } = setup(async () => ({ outcome: 'NOT_FOUND' }), auditTrail);

    const response = await handler.handleRequest(identity, COOKIE, body({}), false);

    expect(response.statusCode).toBe(503);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('shows a failure, never "geen ESF-taken", when Objects fails', async () => {
    const { handler, auditTrail } = setup(async () => {
      throw new HttpClientError('timeout', `objects request failed for formtaak__data__clientnummer__exact__${NUMMER}`);
    });

    const response = await handler.handleRequest(identity, COOKIE, body({}), false);

    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('Er lijkt een probleem met de Objects API te zijn');
    expect(response.body).not.toContain('Geen ESF-taken gevonden');
    expect(auditTrail.events.at(-1)).toMatchObject({ eventType: 'ESF_SEARCH_FINISHED', outcome: 'FAILURE', metadata: { errorCode: 'objects_timeout' } });
    expect(JSON.stringify(logs)).not.toContain(NUMMER);
  });
});
