import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

// @gemeentenijmegen/session calls DynamoDBClient directly, so this fakes the client instead of a repository.
export function createInMemorySessionTable() {
  const client = mockClient(DynamoDBClient);
  const store = new Map<string, Record<string, any>>();

  function wire(): void {
    client.on(PutItemCommand).callsFake((input) => {
      const item = input.Item!;
      store.set(item.sessionid!.S!, item);
      return {};
    });
    client.on(GetItemCommand).callsFake((input) => {
      const item = store.get(input.Key!.sessionid!.S!);
      return item ? { Item: item } : {};
    });
    client.on(UpdateItemCommand).callsFake((input) => {
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
  }

  wire();

  return {
    client,
    store,
    reset(): void {
      client.reset();
      store.clear();
      wire();
    },
  };
}
