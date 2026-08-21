import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { FakeAuditTrail } from '../../../shared/audit/tests/FakeAuditTrail';
import { LogoutRequestHandler } from '../LogoutRequestHandler';

const dynamoMock = mockClient(DynamoDBClient);

describe('LogoutRequestHandler', () => {
  beforeEach(() => {
    dynamoMock.reset();
    process.env.SESSION_TABLE = 'test-sessions-table';
  });

  it('shows the logout confirmation and clears the cookie without touching DynamoDB when there is no session', async () => {
    const auditTrail = new FakeAuditTrail();
    const handler = new LogoutRequestHandler(auditTrail);
    const response = await handler.handleRequest(undefined, new DynamoDBClient({}));

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Uitgelogd</h1>');
    expect(response.body).toContain('href="/login"');
    expect(response.cookies?.[0]).toContain('session=;');
    expect(dynamoMock.commandCalls(UpdateItemCommand)).toHaveLength(0);
    expect(auditTrail.events).toEqual([]);
  });

  it('revokes an active session, clears the cookie and records SESSION_REVOKED and LOGOUT', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        sessionid: { S: 'hash' },
        data: { M: { loggedin: { BOOL: true }, principalId: { S: 'employee-1' }, email: { S: 'medewerker@nijmegen.nl' } } },
      },
    });
    dynamoMock.on(UpdateItemCommand).resolves({});

    const auditTrail = new FakeAuditTrail();
    const handler = new LogoutRequestHandler(auditTrail);
    const response = await handler.handleRequest('session=active-token', new DynamoDBClient({}));

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Uitgelogd</h1>');
    expect(response.cookies?.[0]).toContain('session=;');

    // updateSession replaces the stored data entirely, so principalId is
    // dropped along with everything else, only the revoked flag remains.
    const updateCall = dynamoMock.commandCalls(UpdateItemCommand)[0];
    expect(updateCall.args[0].input.ExpressionAttributeValues?.[':data']).toEqual({
      M: { loggedin: { BOOL: false } },
    });

    expect(auditTrail.events.map((event) => event.eventType)).toEqual(['SESSION_REVOKED', 'LOGOUT']);
    expect(auditTrail.events[0]).toMatchObject({ outcome: 'SUCCESS', actorEmail: 'medewerker@nijmegen.nl' });
    expect(auditTrail.events[1]).toMatchObject({ outcome: 'SUCCESS', actorEmail: 'medewerker@nijmegen.nl' });
  });

  it('is idempotent for an already logged-out session', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: { sessionid: { S: 'hash' }, data: { M: { loggedin: { BOOL: false } } } },
    });
    dynamoMock.on(UpdateItemCommand).resolves({});

    const handler = new LogoutRequestHandler(new FakeAuditTrail());
    const response = await handler.handleRequest('session=already-logged-out-token', new DynamoDBClient({}));

    expect(response.statusCode).toBe(200);
  });

  it('returns a 500 without clearing the cookie and records SESSION_REVOKED as a failure when revocation fails', async () => {
    // @gemeentenijmegen/session logs this failure via console.error itself before rethrowing.
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

    dynamoMock.on(GetItemCommand).resolves({
      Item: { sessionid: { S: 'hash' }, data: { M: { loggedin: { BOOL: true } } } },
    });
    dynamoMock.on(UpdateItemCommand).rejects(new Error('DynamoDB unavailable'));

    const auditTrail = new FakeAuditTrail();
    const handler = new LogoutRequestHandler(auditTrail);
    const response = await handler.handleRequest('session=active-token', new DynamoDBClient({}));

    expect(response.statusCode).toBe(500);
    expect(response.cookies).toBeUndefined();
    expect(auditTrail.events).toEqual([expect.objectContaining({
      eventType: 'SESSION_REVOKED', outcome: 'FAILURE', metadata: { reason: 'DynamoDB unavailable' },
    })]);

    consoleErrorSpy.mockRestore();
  });
});
