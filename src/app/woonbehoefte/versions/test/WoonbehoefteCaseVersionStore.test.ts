import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { caseVersionSortKey, RawCaseImage, WoonbehoefteCaseVersionStore } from '../WoonbehoefteCaseVersionStore';

const clientMock = mockClient(DynamoDBClient);

function newStore(): WoonbehoefteCaseVersionStore {
  return new WoonbehoefteCaseVersionStore(new DynamoDBClient({}), 'test-woonbehoefte-case-versions-table');
}

const CASE_V8_IMAGE: RawCaseImage = {
  pk: { S: 'CASE#OF-2026-00142' },
  sk: { S: 'CASE' },
  caseReference: { S: 'OF-2026-00142' },
  version: { N: '8' },
  status: { S: 'IN_PROGRESS' },
  assessment: { M: { applicationComplete: { S: 'YES' } } },
  check: { M: { requested: { BOOL: false } } },
};

describe('WoonbehoefteCaseVersionStore', () => {
  beforeEach(() => {
    clientMock.reset();
  });

  it('puts a nested snapshot of the raw CASE image under a padded version sort key', async () => {
    clientMock.on(PutItemCommand).resolves({});

    const result = await newStore().putVersion(CASE_V8_IMAGE, {
      eventId: 'event-1', eventName: 'MODIFY', imageSource: 'NEW', recordedAt: '2026-08-25T10:00:00.000Z',
    });

    expect(result).toBe('CREATED');
    const call = clientMock.commandCalls(PutItemCommand)[0];
    expect(call.args[0].input).toMatchObject({
      Item: {
        pk: { S: 'CASE#OF-2026-00142' },
        sk: { S: 'VERSION#000000000008' },
        version: { N: '8' },
        snapshot: { M: CASE_V8_IMAGE },
      },
      ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
    });
  });

  it('treats duplicate stream delivery as an idempotent success, not a throw', async () => {
    clientMock.on(PutItemCommand).rejects(
      Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' }),
    );

    await expect(newStore().putVersion(CASE_V8_IMAGE, {
      eventId: 'event-1', eventName: 'INSERT', imageSource: 'NEW', recordedAt: '2026-08-25T10:00:00.000Z',
    })).resolves.toBe('ALREADY_EXISTS');
  });

  it('rejects a malformed image before ever calling PutItem', async () => {
    const store = newStore();
    const metadata = { eventId: 'event-1', eventName: 'INSERT' as const, imageSource: 'NEW' as const, recordedAt: '2026-08-25T10:00:00.000Z' };

    await expect(store.putVersion({ ...CASE_V8_IMAGE, version: { N: '0' } }, metadata)).rejects.toThrow();
    await expect(store.putVersion({ ...CASE_V8_IMAGE, pk: { S: 'CASE#other-reference' } }, metadata)).rejects.toThrow();
    expect(clientMock.commandCalls(PutItemCommand)).toHaveLength(0);
  });
});

describe('caseVersionSortKey', () => {
  it('pads the version to 12 digits', () => {
    expect(caseVersionSortKey(1)).toBe('VERSION#000000000001');
    expect(caseVersionSortKey(123)).toBe('VERSION#000000000123');
  });

  it('rejects a non-positive or non-integer version', () => {
    expect(() => caseVersionSortKey(0)).toThrow();
    expect(() => caseVersionSortKey(1.5)).toThrow();
  });
});
