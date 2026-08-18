import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { FakeOidcClient } from '../../../shared/auth/tests/FakeOidcClient';
import { LoginRequestHandler } from '../LoginRequestHandler';

const dynamoMock = mockClient(DynamoDBClient);

describe('LoginRequestHandler', () => {
  beforeEach(() => {
    dynamoMock.reset();
    process.env.SESSION_TABLE = 'test-sessions-table';
  });

  it('redirects to home without creating a new session when already logged in', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        sessionid: { S: 'hash' },
        data: { M: { loggedin: { BOOL: true } } },
      },
    });

    const handler = new LoginRequestHandler(new FakeOidcClient());
    const response = await handler.handleRequest('session=existing-token', new DynamoDBClient({}));

    expect(response.statusCode).toBe(302);
    expect(dynamoMock.commandCalls(PutItemCommand)).toHaveLength(0);
  });

  it('creates a pending session (loggedin false) with state, nonce and flowId, and redirects to the authorization url', async () => {
    dynamoMock.on(PutItemCommand).resolves({});
    const oidcClient = new FakeOidcClient();
    oidcClient.authorizationUrl = 'https://login.microsoftonline.com/test-tenant/authorize?state=x';

    const handler = new LoginRequestHandler(oidcClient);
    const response = await handler.handleRequest(undefined, new DynamoDBClient({}));

    expect(response.statusCode).toBe(302);

    const putCall = dynamoMock.commandCalls(PutItemCommand)[0];
    const data = putCall.args[0].input.Item?.data?.M;
    expect(data?.loggedin).toEqual({ BOOL: false });
    expect(data?.state).toEqual({ S: 'fake-state' });
    expect(data?.nonce).toEqual({ S: 'fake-nonce' });
    expect(data?.flowId?.S).toEqual(expect.any(String));
  });

  it('requests only the openid and email scope', async () => {
    dynamoMock.on(PutItemCommand).resolves({});
    const oidcClient = new FakeOidcClient();
    const getAuthorizationUrlSpy = jest.spyOn(oidcClient, 'getAuthorizationUrl');

    const handler = new LoginRequestHandler(oidcClient);
    await handler.handleRequest(undefined, new DynamoDBClient({}));

    expect(getAuthorizationUrlSpy).toHaveBeenCalledWith('fake-state', 'fake-nonce', 'openid email');
  });
});
