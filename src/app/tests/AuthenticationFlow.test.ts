import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { FakeAuditTrail } from '../../shared/audit/tests/FakeAuditTrail';
import { requireSession } from '../../shared/auth/requireSession';
import { FakeOidcClient } from '../../shared/auth/tests/FakeOidcClient';
import { createInMemorySessionTable } from '../../shared/tests/InMemorySessionTable';
import { AuthRequestHandler } from '../auth/AuthRequestHandler';
import { LoginRequestHandler } from '../login/LoginRequestHandler';
import { LogoutRequestHandler } from '../logout/LogoutRequestHandler';

/**
 * Exercises the login -> callback -> protected route -> logout chain end to
 * end, through the same request handlers the Lambdas use, against a fake
 * OIDC provider and an in-memory DynamoDB double.
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
});

describe('full login -> protected route -> logout flow', () => {
  it('lets a medewerker log in, reach a protected route and log out again', async () => {
    const dynamoDBClient = new DynamoDBClient({});
    const oidcClient = new FakeOidcClient();
    oidcClient.authorizationResult = {
      claims: { sub: 'employee-1', email: 'medewerker@nijmegen.nl' },
      scopes: ['openid', 'email'],
    };
    const auditTrail = new FakeAuditTrail();

    const loginResponse = await new LoginRequestHandler(oidcClient, auditTrail).handleRequest(undefined, dynamoDBClient);
    expect(loginResponse.statusCode).toBe(302);
    const pendingCookie = toCookieHeader(loginResponse);
    const pendingSessionData = Array.from(sessionTable.store.values())[0]!.data.M;
    expect(pendingSessionData.flowId.S).toEqual(expect.any(String));

    const callbackResponse = await new AuthRequestHandler({
      cookies: pendingCookie,
      fullUrl: new URL('https://management.example.nl/auth/callback?code=abc&state=fake-state'),
      dynamoDBClient,
      oidcClient,
      auditTrail,
    }).handleRequest();
    expect(callbackResponse.statusCode).toBe(302);
    expect(callbackResponse.headers?.Location).toBe('/');
    const sessionCookie = toCookieHeader(callbackResponse);

    const identity = await requireSession(sessionCookie, dynamoDBClient, auditTrail);
    expect(identity).toEqual({ principalId: 'employee-1', email: 'medewerker@nijmegen.nl' });

    const logoutResponse = await new LogoutRequestHandler(auditTrail).handleRequest(sessionCookie, dynamoDBClient);
    expect(logoutResponse.statusCode).toBe(302);
    expect(logoutResponse.headers?.Location).toBe('/login');

    const identityAfterLogout = await requireSession(sessionCookie, dynamoDBClient, auditTrail);
    expect(identityAfterLogout).toBeUndefined();

    expect(auditTrail.events.map((event) => event.eventType)).toEqual([
      'LOGIN_STARTED',
      'LOGIN_SUCCEEDED',
      'SESSION_CREATED',
      'SESSION_REVOKED',
      'LOGOUT',
      'AUTHENTICATION_DENIED',
    ]);
  });
});

describe('callback without a valid pending session', () => {
  it('redirects to /login and creates no session', async () => {
    const dynamoDBClient = new DynamoDBClient({});
    const oidcClient = new FakeOidcClient();

    const response = await new AuthRequestHandler({
      cookies: undefined,
      fullUrl: new URL('https://management.example.nl/auth/callback?code=abc&state=fake-state'),
      dynamoDBClient,
      oidcClient,
      auditTrail: new FakeAuditTrail(),
    }).handleRequest();

    expect(response.statusCode).toBe(302);
    expect(response.headers?.Location).toBe('/login');
    expect(sessionTable.store.size).toBe(0);
  });
});

describe('replayed authorization code', () => {
  it('keeps the first session valid but rejects a second exchange of the same code', async () => {
    const dynamoDBClient = new DynamoDBClient({});
    const oidcClient = new FakeOidcClient();
    oidcClient.authorizationResult = { claims: { sub: 'employee-1' }, scopes: ['openid'] };
    const auditTrail = new FakeAuditTrail();

    const loginResponse = await new LoginRequestHandler(oidcClient, auditTrail).handleRequest(undefined, dynamoDBClient);
    const pendingCookie = toCookieHeader(loginResponse);
    const fullUrl = new URL('https://management.example.nl/auth/callback?code=abc&state=fake-state');

    const firstCallback = await new AuthRequestHandler({ cookies: pendingCookie, fullUrl, dynamoDBClient, oidcClient, auditTrail }).handleRequest();
    expect(firstCallback.statusCode).toBe(302);
    expect(firstCallback.headers?.Location).toBe('/');
    const sessionCookie = toCookieHeader(firstCallback);

    // Entra's authorization code is single-use: a second exchange attempt with the same
    // pending cookie fails at the idp, which the fake simulates directly here.
    jest.spyOn(oidcClient, 'exchangeAuthorizationCode').mockRejectedValueOnce(new Error('authorization code already used'));
    const secondCallback = await new AuthRequestHandler({ cookies: pendingCookie, fullUrl, dynamoDBClient, oidcClient, auditTrail }).handleRequest();
    expect(secondCallback.statusCode).toBe(302);
    expect(secondCallback.headers?.Location).toBe('/login');

    const stillIdentity = await requireSession(sessionCookie, dynamoDBClient, auditTrail);
    expect(stillIdentity).toEqual({ principalId: 'employee-1' });

    expect(auditTrail.events.map((event) => event.eventType)).toEqual([
      'LOGIN_STARTED', 'LOGIN_SUCCEEDED', 'SESSION_CREATED', 'LOGIN_FAILED',
    ]);
  });
});

describe('expired session', () => {
  it('denies a session once its record has been purged by the DynamoDB TTL', async () => {
    const dynamoDBClient = new DynamoDBClient({});
    const oidcClient = new FakeOidcClient();
    oidcClient.authorizationResult = { claims: { sub: 'employee-1' }, scopes: ['openid'] };
    const auditTrail = new FakeAuditTrail();

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

    sessionTable.store.clear(); // simulate the TTL removing the record

    const identity = await requireSession(sessionCookie, dynamoDBClient, auditTrail);
    expect(identity).toBeUndefined();
  });
});
