import { randomBytes } from 'crypto';
import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../../shared/authorization/PermissionEvaluator';
import { CSRF_COOKIE_NAME } from '../../../../../shared/security/csrf/CsrfProtection';
import { AdditionalEvidenceSearchCaseHandler } from '../AdditionalEvidenceSearchCaseHandler';

const csrfToken = randomBytes(32).toString('base64url');
const cookieHeader = `${CSRF_COOKIE_NAME}=${csrfToken}`;

function makeAuthorizationService(grants: { resource: string; actions: string[] }[]): AuthorizationService {
  const evaluator = new PermissionEvaluator(grants);
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'medewerker' }, evaluator }),
    requireAuthorization: jest.fn().mockImplementation(async (context, check) => (evaluator.evaluate(check) === 'ALLOW' ? undefined : { statusCode: 403 })),
    denyAccess: jest.fn().mockResolvedValue({ statusCode: 403 }),
  } as unknown as AuthorizationService;
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

describe('AdditionalEvidenceSearchCaseHandler', () => {
  it('redirects to the detail page with the searched kenmerk in the query, never writing anything', async () => {
    const handler = new AdditionalEvidenceSearchCaseHandler(makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['view'] }]));

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken, searchCaseReference: 'OF-HOOFD01' }), false,
    );

    expect(response.statusCode).toBe(303);
    expect(response.headers?.Location).toBe('/woonbehoefte/additional-evidence/uuid-1?searchCaseReference=OF-HOOFD01#koppelen');
  });

  it('trims the searched kenmerk', async () => {
    const handler = new AdditionalEvidenceSearchCaseHandler(makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['view'] }]));

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken, searchCaseReference: '  OF-HOOFD01  ' }), false,
    );

    expect(response.headers?.Location).toBe('/woonbehoefte/additional-evidence/uuid-1?searchCaseReference=OF-HOOFD01#koppelen');
  });

  it('denies without woonbehoefte:view', async () => {
    const handler = new AdditionalEvidenceSearchCaseHandler(makeAuthorizationService([]));

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken, searchCaseReference: 'OF-HOOFD01' }), false,
    );

    expect(response.statusCode).toBe(403);
  });

  it('denies a request without a valid CSRF token', async () => {
    const handler = new AdditionalEvidenceSearchCaseHandler(makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['view'] }]));

    const response = await handler.handleRequest(
      { principalId: 'medewerker' }, 'uuid-1', cookieHeader, form({ csrfToken: 'wrong-token', searchCaseReference: 'OF-HOOFD01' }), false,
    );

    expect(response.statusCode).toBe(403);
  });
});
