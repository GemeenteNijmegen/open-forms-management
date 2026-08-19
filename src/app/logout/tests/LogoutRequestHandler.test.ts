import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { LogoutRequestHandler } from '../LogoutRequestHandler';

const dynamoMock = mockClient(DynamoDBClient);

describe('LogoutRequestHandler', () => {
  beforeEach(() => {
    dynamoMock.reset();
    process.env.SESSION_TABLE = 'test-sessions-table';
  });

  it('redirects to /login and clears the cookie without touching DynamoDB when there is no session', async () => {
    const handler = new LogoutRequestHandler();
    const response = await handler.handleRequest(undefined, new DynamoDBClient({}));

    expect(response.statusCode).toBe(302);
    expect(response.headers?.Location).toBe('/login');
    expect(response.cookies?.[0]).toContain('session=;');
    expect(dynamoMock.commandCalls(UpdateItemCommand)).toHaveLength(0);
  });

  it('revokes an active session and clears the cookie', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: { sessionid: { S: 'hash' }, data: { M: { loggedin: { BOOL: true }, principalId: { S: 'employee-1' } } } },
    });
    dynamoMock.on(UpdateItemCommand).resolves({});

    const handler = new LogoutRequestHandler();
    const response = await handler.handleRequest('session=active-token', new DynamoDBClient({}));

    expect(response.statusCode).toBe(302);
    expect(response.headers?.Location).toBe('/login');
    expect(response.cookies?.[0]).toContain('session=;');

    // updateSession replaces the stored data entirely, so principalId is
    // dropped along with everything else, only the revoked flag remains.
    const updateCall = dynamoMock.commandCalls(UpdateItemCommand)[0];
    expect(updateCall.args[0].input.ExpressionAttributeValues?.[':data']).toEqual({
      M: { loggedin: { BOOL: false } },
    });
  });

  it('is idempotent for an already logged-out session', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: { sessionid: { S: 'hash' }, data: { M: { loggedin: { BOOL: false } } } },
    });
    dynamoMock.on(UpdateItemCommand).resolves({});

    const handler = new LogoutRequestHandler();
    const response = await handler.handleRequest('session=already-logged-out-token', new DynamoDBClient({}));

    expect(response.statusCode).toBe(302);
  });

  it('returns a 500 without clearing the cookie when revocation fails', async () => {
    // @gemeentenijmegen/session logs this failure via console.error itself before rethrowing.
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

    dynamoMock.on(GetItemCommand).resolves({
      Item: { sessionid: { S: 'hash' }, data: { M: { loggedin: { BOOL: true } } } },
    });
    dynamoMock.on(UpdateItemCommand).rejects(new Error('DynamoDB unavailable'));

    const handler = new LogoutRequestHandler();
    const response = await handler.handleRequest('session=active-token', new DynamoDBClient({}));

    expect(response.statusCode).toBe(500);
    expect(response.cookies).toBeUndefined();

    consoleErrorSpy.mockRestore();
  });
});
