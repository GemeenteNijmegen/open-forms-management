import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { AuthorizerRequestHandler } from '../AuthorizerRequestHandler';

const dynamoMock = mockClient(DynamoDBClient);

describe('AuthorizerRequestHandler', () => {
  beforeEach(() => {
    dynamoMock.reset();
    process.env.SESSION_TABLE = 'test-sessions-table';
  });

  it('denies when there is no session cookie', async () => {
    const handler = new AuthorizerRequestHandler(new DynamoDBClient({}));

    const result = await handler.handleRequest(undefined);

    expect(result).toEqual({ isAuthorized: false });
    expect(dynamoMock.commandCalls(GetItemCommand)).toHaveLength(0);
  });

  it('denies when the session token is unknown', async () => {
    dynamoMock.on(GetItemCommand).resolves({});

    const handler = new AuthorizerRequestHandler(new DynamoDBClient({}));

    const result = await handler.handleRequest('session=unknown-token');

    expect(result).toEqual({ isAuthorized: false });
  });

  it('denies when the session exists but is not logged in', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: { sessionid: { S: 'hash' }, data: { M: { loggedin: { BOOL: false } } } },
    });

    const handler = new AuthorizerRequestHandler(new DynamoDBClient({}));

    const result = await handler.handleRequest('session=pending-token');

    expect(result).toEqual({ isAuthorized: false });
  });

  it('denies when the session has expired (TTL removed the item)', async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });

    const handler = new AuthorizerRequestHandler(new DynamoDBClient({}));

    const result = await handler.handleRequest('session=expired-token');

    expect(result).toEqual({ isAuthorized: false });
  });

  it('denies when the session is logged in but has no principalId', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: { sessionid: { S: 'hash' }, data: { M: { loggedin: { BOOL: true } } } },
    });

    const handler = new AuthorizerRequestHandler(new DynamoDBClient({}));

    const result = await handler.handleRequest('session=broken-token');

    expect(result).toEqual({ isAuthorized: false });
  });

  it('authorizes and returns a compact identity context for a valid session', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        sessionid: { S: 'hash' },
        data: { M: { loggedin: { BOOL: true }, principalId: { S: 'employee-principal-id' } } },
      },
    });

    const handler = new AuthorizerRequestHandler(new DynamoDBClient({}));

    const result = await handler.handleRequest('session=valid-token');

    expect(result).toEqual({ isAuthorized: true, context: { principalId: 'employee-principal-id' } });
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

    const handler = new AuthorizerRequestHandler(new DynamoDBClient({}));

    const result = await handler.handleRequest('session=valid-token');

    expect(result).toEqual({
      isAuthorized: true,
      context: { principalId: 'employee-principal-id', email: 'medewerker@nijmegen.nl' },
    });
  });
});
