import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { metrics } from '../../../observability/Metrics';
import { FakeAuditTrail } from '../../../shared/audit/tests/FakeAuditTrail';
import { FakeOidcClient } from '../../../shared/auth/tests/FakeOidcClient';
import { AuthRequestHandler } from '../AuthRequestHandler';

const dynamoMock = mockClient(DynamoDBClient);

describe('AuthRequestHandler', () => {
  const fullUrl = new URL('https://management.example.nl/auth/callback?code=abc&state=fake-state');

  beforeEach(() => {
    dynamoMock.reset();
    process.env.SESSION_TABLE = 'test-sessions-table';
  });

  it('redirects to /login on an idp error without a pending session, without auditing or initializing the OIDC client', async () => {
    const getOidcClient = jest.fn(async () => new FakeOidcClient());
    const auditTrail = new FakeAuditTrail();
    const handler = new AuthRequestHandler({
      cookies: undefined,
      fullUrl,
      queryStringParamError: 'access_denied',
      dynamoDBClient: new DynamoDBClient({}),
      getOidcClient,
      auditTrail,
    });

    const response = await handler.handleRequest();

    expect(response.statusCode).toBe(302);
    expect(dynamoMock.commandCalls(GetItemCommand)).toHaveLength(0);
    expect(getOidcClient).not.toHaveBeenCalled();
    expect(auditTrail.events).toHaveLength(0);
  });

  it('redirects to /login and records LOGIN_FAILED when the idp reports an error for a known pending flow', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        sessionid: { S: 'hash' },
        data: { M: { loggedin: { BOOL: false }, state: { S: 'fake-state' }, nonce: { S: 'fake-nonce' }, flowId: { S: 'fake-flow-id' } } },
      },
    });
    const auditTrail = new FakeAuditTrail();
    const addMetricSpy = jest.spyOn(metrics, 'addMetric');

    const handler = new AuthRequestHandler({
      cookies: 'session=pending-token',
      fullUrl,
      queryStringParamError: 'access_denied',
      dynamoDBClient: new DynamoDBClient({}),
      getOidcClient: async () => new FakeOidcClient(),
      auditTrail,
    });

    const response = await handler.handleRequest();

    expect(response.statusCode).toBe(302);
    expect(auditTrail.events).toEqual([expect.objectContaining({
      eventType: 'LOGIN_FAILED', outcome: 'FAILURE', flowId: 'fake-flow-id', metadata: { reason: 'access_denied' },
    })]);
    expect(addMetricSpy.mock.calls.map((call) => call[0])).toEqual(['LoginFailure']);
  });

  it('redirects to /login when there is no pending login session', async () => {
    const handler = new AuthRequestHandler({
      cookies: undefined,
      fullUrl,
      dynamoDBClient: new DynamoDBClient({}),
      getOidcClient: async () => new FakeOidcClient(),
      auditTrail: new FakeAuditTrail(),
    });

    const response = await handler.handleRequest();

    expect(response.statusCode).toBe(302);
  });

  it('redirects to /login when the pending session has no state/nonce', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: { sessionid: { S: 'hash' }, data: { M: { loggedin: { BOOL: false } } } },
    });

    const handler = new AuthRequestHandler({
      cookies: 'session=pending-token',
      fullUrl,
      dynamoDBClient: new DynamoDBClient({}),
      getOidcClient: async () => new FakeOidcClient(),
      auditTrail: new FakeAuditTrail(),
    });

    const response = await handler.handleRequest();

    expect(response.statusCode).toBe(302);
  });

  it('exchanges the code, maps the identity and creates a fresh session on success', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        sessionid: { S: 'hash' },
        data: {
          M: {
            loggedin: { BOOL: false },
            state: { S: 'fake-state' },
            nonce: { S: 'fake-nonce' },
            flowId: { S: 'fake-flow-id' },
          },
        },
      },
    });
    dynamoMock.on(PutItemCommand).resolves({});

    const oidcClient = new FakeOidcClient();
    oidcClient.authorizationResult = {
      claims: { sub: 'employee-principal-id', email: 'medewerker@nijmegen.nl' },
      scopes: ['openid', 'email'],
    };

    const handler = new AuthRequestHandler({
      cookies: 'session=pending-token',
      fullUrl,
      dynamoDBClient: new DynamoDBClient({}),
      getOidcClient: async () => oidcClient,
      auditTrail: new FakeAuditTrail(),
    });

    const response = await handler.handleRequest();

    expect(response.statusCode).toBe(302);

    const putCall = dynamoMock.commandCalls(PutItemCommand)[0];
    const data = putCall.args[0].input.Item?.data?.M;
    expect(data?.loggedin).toEqual({ BOOL: true });
    expect(data?.principalId).toEqual({ S: 'employee-principal-id' });
    expect(data?.email).toEqual({ S: 'medewerker@nijmegen.nl' });
  });

  it('records LOGIN_SUCCEEDED and SESSION_CREATED with the actor email on success', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        sessionid: { S: 'hash' },
        data: {
          M: {
            loggedin: { BOOL: false },
            state: { S: 'fake-state' },
            nonce: { S: 'fake-nonce' },
            flowId: { S: 'fake-flow-id' },
          },
        },
      },
    });
    dynamoMock.on(PutItemCommand).resolves({});

    const oidcClient = new FakeOidcClient();
    oidcClient.authorizationResult = {
      claims: { sub: 'employee-principal-id', email: 'medewerker@nijmegen.nl' },
      scopes: ['openid', 'email'],
    };
    const auditTrail = new FakeAuditTrail();
    const addMetricSpy = jest.spyOn(metrics, 'addMetric');

    const handler = new AuthRequestHandler({
      cookies: 'session=pending-token',
      fullUrl,
      dynamoDBClient: new DynamoDBClient({}),
      getOidcClient: async () => oidcClient,
      auditTrail,
    });

    await handler.handleRequest();

    expect(auditTrail.events.map((event) => event.eventType)).toEqual(['LOGIN_SUCCEEDED', 'SESSION_CREATED']);
    expect(auditTrail.events[0]).toMatchObject({ outcome: 'SUCCESS', actorEmail: 'medewerker@nijmegen.nl', flowId: 'fake-flow-id' });
    expect(auditTrail.events[1]).toMatchObject({ outcome: 'SUCCESS', actorEmail: 'medewerker@nijmegen.nl', flowId: 'fake-flow-id' });
    expect(addMetricSpy.mock.calls.map((call) => call[0])).toEqual(['LoginSuccess', 'SessionCreated']);
  });

  it('redirects to /login without creating a session when the code exchange fails (e.g. state/nonce mismatch)', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        sessionid: { S: 'hash' },
        data: { M: { loggedin: { BOOL: false }, state: { S: 'fake-state' }, nonce: { S: 'fake-nonce' } } },
      },
    });

    const oidcClient = new FakeOidcClient();
    jest.spyOn(oidcClient, 'exchangeAuthorizationCode').mockRejectedValue(new Error('state mismatch'));
    const auditTrail = new FakeAuditTrail();
    const addMetricSpy = jest.spyOn(metrics, 'addMetric');

    const handler = new AuthRequestHandler({
      cookies: 'session=pending-token',
      fullUrl,
      dynamoDBClient: new DynamoDBClient({}),
      getOidcClient: async () => oidcClient,
      auditTrail,
    });

    const response = await handler.handleRequest();

    expect(response.statusCode).toBe(302);
    expect(dynamoMock.commandCalls(PutItemCommand)).toHaveLength(0);
    expect(auditTrail.events).toEqual([expect.objectContaining({
      eventType: 'LOGIN_FAILED', outcome: 'FAILURE', metadata: { reason: 'state mismatch' },
    })]);
    expect(addMetricSpy.mock.calls.map((call) => call[0])).toEqual(['LoginFailure']);
  });

  it('redirects to /login without creating a session when the claims cannot be mapped to an identity', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        sessionid: { S: 'hash' },
        data: { M: { loggedin: { BOOL: false }, state: { S: 'fake-state' }, nonce: { S: 'fake-nonce' } } },
      },
    });

    const oidcClient = new FakeOidcClient();
    oidcClient.authorizationResult = { claims: { sub: '' }, scopes: ['openid'] };

    const handler = new AuthRequestHandler({
      cookies: 'session=pending-token',
      fullUrl,
      dynamoDBClient: new DynamoDBClient({}),
      getOidcClient: async () => oidcClient,
      auditTrail: new FakeAuditTrail(),
    });

    const response = await handler.handleRequest();

    expect(response.statusCode).toBe(302);
    expect(dynamoMock.commandCalls(PutItemCommand)).toHaveLength(0);
  });

  it('returns a 500 when creating the session fails after a successful exchange', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        sessionid: { S: 'hash' },
        data: { M: { loggedin: { BOOL: false }, state: { S: 'fake-state' }, nonce: { S: 'fake-nonce' } } },
      },
    });
    dynamoMock.on(PutItemCommand).rejects(new Error('DynamoDB unavailable'));

    const oidcClient = new FakeOidcClient();
    oidcClient.authorizationResult = { claims: { sub: 'employee-principal-id' }, scopes: ['openid'] };
    const auditTrail = new FakeAuditTrail();
    const addMetricSpy = jest.spyOn(metrics, 'addMetric');

    const handler = new AuthRequestHandler({
      cookies: 'session=pending-token',
      fullUrl,
      dynamoDBClient: new DynamoDBClient({}),
      getOidcClient: async () => oidcClient,
      auditTrail,
    });

    const response = await handler.handleRequest();

    expect(response.statusCode).toBe(500);
    expect(auditTrail.events.map((event) => event.eventType)).toEqual(['LOGIN_FAILED']);
    expect(auditTrail.events[0]).toMatchObject({ outcome: 'FAILURE', metadata: { reason: 'DynamoDB unavailable' } });
    expect(addMetricSpy.mock.calls.map((call) => call[0])).toEqual(['LoginFailure']);
  });
});
