import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { metrics } from '../../../observability/Metrics';
import { FakeAuditTrail } from '../../audit/tests/FakeAuditTrail';
import { requireSession } from '../requireSession';

const dynamoMock = mockClient(DynamoDBClient);

describe('requireSession', () => {
  beforeEach(() => {
    dynamoMock.reset();
    process.env.SESSION_TABLE = 'test-sessions-table';
  });

  it('denies when there is no session cookie', async () => {
    const auditTrail = new FakeAuditTrail();
    const addMetricSpy = jest.spyOn(metrics, 'addMetric');

    const identity = await requireSession(undefined, new DynamoDBClient({}), auditTrail);

    expect(identity).toBeUndefined();
    expect(dynamoMock.commandCalls(GetItemCommand)).toHaveLength(0);
    expect(auditTrail.events).toEqual([expect.objectContaining({ eventType: 'AUTHENTICATION_DENIED', outcome: 'DENIED' })]);
    expect(addMetricSpy.mock.calls.map((call) => call[0])).toEqual(['AuthenticationDenied']);
  });

  it('denies when the session token is unknown', async () => {
    dynamoMock.on(GetItemCommand).resolves({});
    const addMetricSpy = jest.spyOn(metrics, 'addMetric');

    const identity = await requireSession('session=unknown-token', new DynamoDBClient({}), new FakeAuditTrail());

    expect(identity).toBeUndefined();
    expect(addMetricSpy.mock.calls.map((call) => call[0])).toEqual(['AuthenticationDenied', 'SessionExpired']);
  });

  it('denies when the session exists but is not logged in', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: { sessionid: { S: 'hash' }, data: { M: { loggedin: { BOOL: false } } } },
    });
    const addMetricSpy = jest.spyOn(metrics, 'addMetric');

    const identity = await requireSession('session=pending-token', new DynamoDBClient({}), new FakeAuditTrail());

    expect(identity).toBeUndefined();
    expect(addMetricSpy.mock.calls.map((call) => call[0])).toEqual(['AuthenticationDenied', 'SessionExpired']);
  });

  it('denies when the session has expired (TTL removed the item)', async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });
    const addMetricSpy = jest.spyOn(metrics, 'addMetric');

    const identity = await requireSession('session=expired-token', new DynamoDBClient({}), new FakeAuditTrail());

    expect(identity).toBeUndefined();
    expect(addMetricSpy.mock.calls.map((call) => call[0])).toEqual(['AuthenticationDenied', 'SessionExpired']);
  });

  it('denies when the session is logged in but has no principalId', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: { sessionid: { S: 'hash' }, data: { M: { loggedin: { BOOL: true } } } },
    });

    const auditTrail = new FakeAuditTrail();
    const addMetricSpy = jest.spyOn(metrics, 'addMetric');

    const identity = await requireSession('session=broken-token', new DynamoDBClient({}), auditTrail);

    expect(identity).toBeUndefined();
    expect(auditTrail.events).toEqual([expect.objectContaining({
      eventType: 'AUTHENTICATION_DENIED', outcome: 'DENIED', metadata: { reason: 'missing-principal-id' },
    })]);
    expect(addMetricSpy.mock.calls.map((call) => call[0])).toEqual(['AuthenticationDenied']);
  });

  it('returns the identity for a valid session', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        sessionid: { S: 'hash' },
        data: { M: { loggedin: { BOOL: true }, principalId: { S: 'employee-principal-id' } } },
      },
    });

    const auditTrail = new FakeAuditTrail();

    const identity = await requireSession('session=valid-token', new DynamoDBClient({}), auditTrail);

    expect(identity).toEqual({ principalId: 'employee-principal-id' });
    expect(auditTrail.events).toEqual([]);
  });

  it('includes email in the identity when the session has one, for permission lookups keyed on email', async () => {
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

    const identity = await requireSession('session=valid-token', new DynamoDBClient({}), new FakeAuditTrail());

    expect(identity).toEqual({ principalId: 'employee-principal-id', email: 'medewerker@nijmegen.nl' });
  });
});
