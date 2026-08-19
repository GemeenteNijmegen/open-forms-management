import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { FakeAuditTrail } from '../../shared/audit/tests/FakeAuditTrail';
import { FakeOidcClient } from '../../shared/auth/tests/FakeOidcClient';
import { AuthRequestHandler } from '../auth/AuthRequestHandler';
import { AuthorizerRequestHandler } from '../authorizer/AuthorizerRequestHandler';
import { LoginRequestHandler } from '../login/LoginRequestHandler';
import { LogoutRequestHandler } from '../logout/LogoutRequestHandler';

/**
 * Exercises the login -> callback -> protected route -> logout chain end to
 * end, through the same request handlers the Lambdas use, against a fake
 * OIDC provider and an in-memory DynamoDB double.
 */

const dynamoMock = mockClient(DynamoDBClient);
let store: Map<string, Record<string, any>>;

function toCookieHeader(response: { cookies?: string[] }): string {
  const cookie = response.cookies?.[0];
  if (!cookie) {
    throw new Error('Response did not set a cookie');
  }
  return cookie.split(';')[0];
}

beforeEach(() => {
  dynamoMock.reset();
  process.env.SESSION_TABLE = 'test-sessions-table';
  store = new Map();

  dynamoMock.on(PutItemCommand).callsFake((input) => {
    const item = input.Item!;
    store.set(item.sessionid!.S!, item);
    return {};
  });
  dynamoMock.on(GetItemCommand).callsFake((input) => {
    const item = store.get(input.Key!.sessionid!.S!);
    return item ? { Item: item } : {};
  });
  dynamoMock.on(UpdateItemCommand).callsFake((input) => {
    const key = input.Key!.sessionid!.S!;
    const existing = store.get(key);
    if (!existing) {
      throw new Error('Cannot update a session that does not exist');
    }
    store.set(key, {
      ...existing,
      data: input.ExpressionAttributeValues![':data'],
      ttl: input.ExpressionAttributeValues![':ttl'],
    });
    return {};
  });
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
    const pendingSessionData = Array.from(store.values())[0]!.data.M;
    expect(pendingSessionData.flowId.S).toEqual(expect.any(String));

    const callbackResponse = await new AuthRequestHandler({
      cookies: pendingCookie,
      fullUrl: new URL('https://management.example.nl/auth/callback?code=abc&state=fake-state'),
      dynamoDBClient,
      oidcClient,
      auditTrail,
    }).handleRequest();
    expect(callbackResponse.statusCode).toBe(302);
    expect(callbackResponse.headers?.Location).toBe('/home');
    const sessionCookie = toCookieHeader(callbackResponse);

    const authorized = await new AuthorizerRequestHandler(dynamoDBClient, auditTrail).handleRequest(sessionCookie);
    expect(authorized).toEqual({
      isAuthorized: true,
      context: { principalId: 'employee-1', email: 'medewerker@nijmegen.nl' },
    });

    const logoutResponse = await new LogoutRequestHandler(auditTrail).handleRequest(sessionCookie, dynamoDBClient);
    expect(logoutResponse.statusCode).toBe(302);
    expect(logoutResponse.headers?.Location).toBe('/login');

    const deniedAfterLogout = await new AuthorizerRequestHandler(dynamoDBClient, auditTrail).handleRequest(sessionCookie);
    expect(deniedAfterLogout).toEqual({ isAuthorized: false });

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
    expect(store.size).toBe(0);
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
    expect(firstCallback.headers?.Location).toBe('/home');
    const sessionCookie = toCookieHeader(firstCallback);

    // Entra's authorization code is single-use: a second exchange attempt with the same
    // pending cookie fails at the idp, which the fake simulates directly here.
    jest.spyOn(oidcClient, 'exchangeAuthorizationCode').mockRejectedValueOnce(new Error('authorization code already used'));
    const secondCallback = await new AuthRequestHandler({ cookies: pendingCookie, fullUrl, dynamoDBClient, oidcClient, auditTrail }).handleRequest();
    expect(secondCallback.statusCode).toBe(302);
    expect(secondCallback.headers?.Location).toBe('/login');

    const stillAuthorized = await new AuthorizerRequestHandler(dynamoDBClient, auditTrail).handleRequest(sessionCookie);
    expect(stillAuthorized).toEqual({ isAuthorized: true, context: { principalId: 'employee-1' } });

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

    store.clear(); // simulate the TTL removing the record

    const denied = await new AuthorizerRequestHandler(dynamoDBClient, auditTrail).handleRequest(sessionCookie);
    expect(denied).toEqual({ isAuthorized: false });
  });
});
