import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { metrics } from '../../../observability/Metrics';
import { FakeAuditTrail } from '../../../shared/audit/tests/FakeAuditTrail';
import { AuthorizerRequestHandler } from '../AuthorizerRequestHandler';

const dynamoMock = mockClient(DynamoDBClient);

describe('AuthorizerRequestHandler', () => {
  beforeEach(() => {
    dynamoMock.reset();
    process.env.SESSION_TABLE = 'test-sessions-table';
  });

  it('denies when there is no session cookie', async () => {
    const auditTrail = new FakeAuditTrail();
    const addMetricSpy = jest.spyOn(metrics, 'addMetric');
    const handler = new AuthorizerRequestHandler(new DynamoDBClient({}), auditTrail);

    const result = await handler.handleRequest(undefined);

    expect(result).toEqual({ isAuthorized: false });
    expect(dynamoMock.commandCalls(GetItemCommand)).toHaveLength(0);
    expect(auditTrail.events).toEqual([expect.objectContaining({ eventType: 'AUTHENTICATION_DENIED', outcome: 'DENIED' })]);
    expect(addMetricSpy.mock.calls.map((call) => call[0])).toEqual(['AuthenticationDenied']);
  });

  it('denies when the session token is unknown', async () => {
    dynamoMock.on(GetItemCommand).resolves({});
    const addMetricSpy = jest.spyOn(metrics, 'addMetric');

    const handler = new AuthorizerRequestHandler(new DynamoDBClient({}), new FakeAuditTrail());

    const result = await handler.handleRequest('session=unknown-token');

    expect(result).toEqual({ isAuthorized: false });
    expect(addMetricSpy.mock.calls.map((call) => call[0])).toEqual(['AuthenticationDenied', 'SessionExpired']);
  });

  it('denies when the session exists but is not logged in', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: { sessionid: { S: 'hash' }, data: { M: { loggedin: { BOOL: false } } } },
    });
    const addMetricSpy = jest.spyOn(metrics, 'addMetric');

    const handler = new AuthorizerRequestHandler(new DynamoDBClient({}), new FakeAuditTrail());

    const result = await handler.handleRequest('session=pending-token');

    expect(result).toEqual({ isAuthorized: false });
    expect(addMetricSpy.mock.calls.map((call) => call[0])).toEqual(['AuthenticationDenied', 'SessionExpired']);
  });

  it('denies when the session has expired (TTL removed the item)', async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });
    const addMetricSpy = jest.spyOn(metrics, 'addMetric');

    const handler = new AuthorizerRequestHandler(new DynamoDBClient({}), new FakeAuditTrail());

    const result = await handler.handleRequest('session=expired-token');

    expect(result).toEqual({ isAuthorized: false });
    expect(addMetricSpy.mock.calls.map((call) => call[0])).toEqual(['AuthenticationDenied', 'SessionExpired']);
  });

  it('denies when the session is logged in but has no principalId', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: { sessionid: { S: 'hash' }, data: { M: { loggedin: { BOOL: true } } } },
    });

    const auditTrail = new FakeAuditTrail();
    const addMetricSpy = jest.spyOn(metrics, 'addMetric');
    const handler = new AuthorizerRequestHandler(new DynamoDBClient({}), auditTrail);

    const result = await handler.handleRequest('session=broken-token');

    expect(result).toEqual({ isAuthorized: false });
    expect(auditTrail.events).toEqual([expect.objectContaining({
      eventType: 'AUTHENTICATION_DENIED', outcome: 'DENIED', metadata: { reason: 'missing-principal-id' },
    })]);
    expect(addMetricSpy.mock.calls.map((call) => call[0])).toEqual(['AuthenticationDenied']);
  });

  it('authorizes and returns a compact identity context for a valid session', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        sessionid: { S: 'hash' },
        data: { M: { loggedin: { BOOL: true }, principalId: { S: 'employee-principal-id' } } },
      },
    });

    const auditTrail = new FakeAuditTrail();
    const handler = new AuthorizerRequestHandler(new DynamoDBClient({}), auditTrail);

    const result = await handler.handleRequest('session=valid-token');

    expect(result).toEqual({ isAuthorized: true, context: { principalId: 'employee-principal-id' } });
    expect(auditTrail.events).toEqual([]);
  });

  it('includes email in the context when the session has one, for permission lookups keyed on email', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        sessionid: { S: 'hash' },
        data: {
          M: {
            loggedin: { BOOL: true },
            principalId: { S: 'employee-principal-id' },
            email: { S: 'medewerker@nijmegen.nl' },
          },
        },
      },
    });

    const handler = new AuthorizerRequestHandler(new DynamoDBClient({}), new FakeAuditTrail());

    const result = await handler.handleRequest('session=valid-token');

    expect(result).toEqual({
      isAuthorized: true,
      context: { principalId: 'employee-principal-id', email: 'medewerker@nijmegen.nl' },
    });
  });
});
