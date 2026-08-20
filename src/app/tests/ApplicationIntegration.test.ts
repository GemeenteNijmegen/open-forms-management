import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { FakeAuditTrail } from '../../shared/audit/tests/FakeAuditTrail';
import { requireSession } from '../../shared/auth/requireSession';
import { FakeOidcClient } from '../../shared/auth/tests/FakeOidcClient';
import { AuthorizationService } from '../../shared/authorization/AuthorizationService';
import { FakePermissionRepository } from '../../shared/authorization/tests/FakePermissionRepository';
import { createInMemorySessionTable } from '../../shared/tests/InMemorySessionTable';
import { AuthRequestHandler } from '../auth/AuthRequestHandler';
import { HomeRequestHandler } from '../home/HomeRequestHandler';
import { LoginRequestHandler } from '../login/LoginRequestHandler';
import { LogoutRequestHandler } from '../logout/LogoutRequestHandler';

/**
 * Extends the login/callback/logout chain from AuthenticationFlow.test.ts (BF-017) into what happens
 * inside an authenticated session: home rendering, a permission check and its audit trail, through the
 * same real request handlers. Global admin/resource-admin feature visibility is already covered by
 * FeatureRegistry.test.ts; expired/revoked sessions by AuthenticationFlow.test.ts, not repeated here.
 */

const sessionTable = createInMemorySessionTable();

function toCookieHeader(response: { cookies?: string[] }): string {
  const cookie = response.cookies?.[0];
  if (!cookie) {
    throw new Error('Response did not set a cookie');
  }
  return cookie.split(';')[0];
}

beforeEach(() => {
  sessionTable.reset();
  process.env.SESSION_TABLE = 'test-sessions-table';
  process.env._X_AMZN_TRACE_ID = 'Root=1-test-trace;Parent=abc;Sampled=1';
});

afterEach(() => {
  delete process.env._X_AMZN_TRACE_ID;
});

describe('login -> home -> permission check -> logout', () => {
  it('renders home for a medewerker without grants, denies an unrelated resource, and audits both', async () => {
    const dynamoDBClient = new DynamoDBClient({});
    const oidcClient = new FakeOidcClient();
    oidcClient.authorizationResult = {
      claims: { sub: 'employee-1', email: 'medewerker@nijmegen.nl' },
      scopes: ['openid', 'email'],
    };
    const auditTrail = new FakeAuditTrail();
    const authorizationService = new AuthorizationService(new FakePermissionRepository(), auditTrail);

    const loginResponse = await new LoginRequestHandler(oidcClient, auditTrail).handleRequest(undefined, dynamoDBClient);
    const pendingCookie = toCookieHeader(loginResponse);
    const callbackResponse = await new AuthRequestHandler({
      cookies: pendingCookie,
      fullUrl: new URL('https://management.example.nl/auth/callback?code=abc&state=fake-state'),
      dynamoDBClient,
      oidcClient,
      auditTrail,
    }).handleRequest();
    const sessionCookie = toCookieHeader(callbackResponse);

    // A missing or invalid session always yields a 302 to /login from the page lambda itself, never a raw
    // 401/403 (ADR-031) - there is no separate authorizer Lambda to produce one.
    const identity = await requireSession(sessionCookie, dynamoDBClient, auditTrail);
    expect(identity).toEqual({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });

    const homeResponse = await new HomeRequestHandler(authorizationService).handleRequest(identity, '/');
    expect(homeResponse.statusCode).toBe(200);
    expect(homeResponse.body).toContain('Welkom, medewerker@nijmegen.nl');
    expect(homeResponse.body).toContain('Er zijn nog geen onderdelen beschikbaar');

    const authContext = await authorizationService.loadContext(identity);
    const denied = await authorizationService.requireAuthorization(authContext, { resource: 'testresource', action: 'view' });
    expect(denied?.statusCode).toBe(403);
    expect(denied?.body).toContain('Geen toegang');

    const logoutResponse = await new LogoutRequestHandler(auditTrail).handleRequest(sessionCookie, dynamoDBClient);
    expect(logoutResponse.statusCode).toBe(200);

    expect(auditTrail.events.map((event) => event.eventType)).toEqual([
      'LOGIN_STARTED', 'LOGIN_SUCCEEDED', 'SESSION_CREATED', 'ACCESS_DENIED', 'SESSION_REVOKED', 'LOGOUT',
    ]);
    expect(auditTrail.events.find((event) => event.eventType === 'ACCESS_DENIED')).toMatchObject({
      resource: 'testresource',
      action: 'view',
      actorEmail: 'medewerker@nijmegen.nl',
      correlationId: '1-test-trace',
    });
  });
});
