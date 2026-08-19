import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { logger } from '../../../observability/Logger';
import { DynamoDbAuditTrail } from '../DynamoDbAuditTrail';

const documentMock = mockClient(DynamoDBDocumentClient);

function newAuditTrail() {
  return new DynamoDbAuditTrail(DynamoDBDocumentClient.from(new DynamoDBClient({})), 'test-audit-trail-table');
}

const EVENT_ID_1 = '11111111-1111-4111-8111-111111111111';
const EVENT_ID_2 = '22222222-2222-4222-8222-222222222222';

const validItem = {
  pk: 'AUDIT',
  sk: `2026-01-01T00:00:00.000Z#${EVENT_ID_1}`,
  eventId: EVENT_ID_1,
  occurredAt: '2026-01-01T00:00:00.000Z',
  eventType: 'LOGIN_STARTED',
  outcome: 'SUCCESS',
  correlationId: 'trace-1',
};

// The mapped AuditEvent for validItem: pk/sk are DynamoDB key plumbing, not part of the domain model.
const validEvent = {
  eventId: EVENT_ID_1,
  occurredAt: '2026-01-01T00:00:00.000Z',
  eventType: 'LOGIN_STARTED',
  outcome: 'SUCCESS',
  correlationId: 'trace-1',
};

describe('DynamoDbAuditTrail', () => {
  beforeEach(() => {
    documentMock.reset();
    jest.spyOn(logger, 'error').mockImplementation(() => { });
    jest.spyOn(logger, 'warn').mockImplementation(() => { });
  });

  describe('record', () => {
    it('writes an event with a fixed pk and a sortable occurredAt#eventId sk', async () => {
      documentMock.on(PutCommand).resolves({});

      await newAuditTrail().record({
        eventType: 'LOGIN_STARTED',
        outcome: 'SUCCESS',
        correlationId: 'trace-1',
      });

      const call = documentMock.commandCalls(PutCommand)[0];
      const item = call.args[0].input.Item as Record<string, unknown>;
      expect(call.args[0].input.TableName).toBe('test-audit-trail-table');
      expect(item.pk).toBe('AUDIT');
      expect(item.sk).toBe(`${item.occurredAt}#${item.eventId}`);
      expect(item.eventId).toEqual(expect.any(String));
      expect(item.occurredAt).toEqual(expect.any(String));
      expect(item.eventType).toBe('LOGIN_STARTED');
      expect(item.outcome).toBe('SUCCESS');
      expect(item.correlationId).toBe('trace-1');
      expect(item).not.toHaveProperty('actorEmail');

      const occurredAtSeconds = Math.floor(new Date(item.occurredAt as string).getTime() / 1000);
      const twoYearsInSeconds = 2 * 365 * 24 * 60 * 60;
      expect(item.ttl).toBe(occurredAtSeconds + twoYearsInSeconds);
    });

    it('stores actorEmail as a plain attribute when given, not as part of the key', async () => {
      documentMock.on(PutCommand).resolves({});

      await newAuditTrail().record({
        eventType: 'ACCESS_DENIED',
        outcome: 'DENIED',
        correlationId: 'trace-2',
        actorEmail: 'medewerker@nijmegen.nl',
        resource: 'sport',
        action: 'write',
        flowId: 'flow-1',
        metadata: { reason: 'no-grant' },
      });

      const call = documentMock.commandCalls(PutCommand)[0];
      const item = call.args[0].input.Item as Record<string, unknown>;
      expect(item.pk).toBe('AUDIT');
      expect(item.actorEmail).toBe('medewerker@nijmegen.nl');
      expect(item.resource).toBe('sport');
      expect(item.action).toBe('write');
      expect(item.flowId).toBe('flow-1');
      expect(item.metadata).toEqual({ reason: 'no-grant' });
    });

    it('logs an ERROR and propagates the failure when the write fails', async () => {
      documentMock.on(PutCommand).rejects(new Error('ProvisionedThroughputExceededException'));

      await expect(newAuditTrail().record({ eventType: 'LOGIN_STARTED', outcome: 'SUCCESS', correlationId: 'trace-1' }))
        .rejects.toThrow('ProvisionedThroughputExceededException');

      expect(logger.error).toHaveBeenCalledWith('Audit write failed', {
        eventType: 'LOGIN_STARTED',
        reason: 'ProvisionedThroughputExceededException',
      });
    });
  });

  describe('findLatest', () => {
    it('queries the fixed pk, newest first, with the given limit, and maps every item', async () => {
      documentMock.on(QueryCommand).resolves({
        Items: [{
          pk: 'AUDIT',
          sk: `2026-01-02T00:00:00.000Z#${EVENT_ID_1}`,
          eventId: EVENT_ID_1,
          occurredAt: '2026-01-02T00:00:00.000Z',
          eventType: 'LOGIN_SUCCEEDED',
          outcome: 'SUCCESS',
          correlationId: 'trace-1',
        }],
      });

      const events = await newAuditTrail().findLatest(100);

      expect(events).toEqual([{
        eventId: EVENT_ID_1,
        occurredAt: '2026-01-02T00:00:00.000Z',
        eventType: 'LOGIN_SUCCEEDED',
        outcome: 'SUCCESS',
        correlationId: 'trace-1',
      }]);

      const call = documentMock.commandCalls(QueryCommand)[0];
      expect(call.args[0].input).toMatchObject({
        TableName: 'test-audit-trail-table',
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': 'AUDIT' },
        ScanIndexForward: false,
        Limit: 100,
      });
    });

    it('returns an empty array when there are no events', async () => {
      documentMock.on(QueryCommand).resolves({ Items: [] });

      expect(await newAuditTrail().findLatest(10)).toEqual([]);
    });

    it('uses a default limit when none is given', async () => {
      documentMock.on(QueryCommand).resolves({ Items: [] });

      await newAuditTrail().findLatest();

      const call = documentMock.commandCalls(QueryCommand)[0];
      expect(call.args[0].input.Limit).toBe(100);
    });

    it('pages through LastEvaluatedKey until it has collected limit items', async () => {
      documentMock.on(QueryCommand)
        .resolvesOnce({ Items: [{ ...validItem, eventId: EVENT_ID_1 }], LastEvaluatedKey: { pk: 'AUDIT', sk: 'page-1' } })
        .resolvesOnce({ Items: [{ ...validItem, eventId: EVENT_ID_2 }] });

      const events = await newAuditTrail().findLatest(2);

      expect(events.map((event) => event.eventId)).toEqual([EVENT_ID_1, EVENT_ID_2]);
      expect(documentMock.commandCalls(QueryCommand)).toHaveLength(2);
      expect(documentMock.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey).toEqual({ pk: 'AUDIT', sk: 'page-1' });
      expect(documentMock.commandCalls(QueryCommand)[1].args[0].input.Limit).toBe(1);
    });

    it('stops paging once the requested limit has been collected', async () => {
      documentMock.on(QueryCommand)
        .resolvesOnce({ Items: [{ ...validItem, eventId: EVENT_ID_1 }], LastEvaluatedKey: { pk: 'AUDIT', sk: 'page-1' } });

      const events = await newAuditTrail().findLatest(1);

      expect(events.map((event) => event.eventId)).toEqual([EVENT_ID_1]);
      expect(documentMock.commandCalls(QueryCommand)).toHaveLength(1);
    });
  });

  describe('findByActor', () => {
    it('queries the fixed pk with a filter on actorEmail, no date range given', async () => {
      documentMock.on(QueryCommand).resolves({
        Items: [{ ...validItem, actorEmail: 'medewerker@nijmegen.nl' }],
      });

      const events = await newAuditTrail().findByActor('medewerker@nijmegen.nl', 100);

      expect(events.map((event) => event.eventId)).toEqual([EVENT_ID_1]);

      const call = documentMock.commandCalls(QueryCommand)[0];
      expect(call.args[0].input).toMatchObject({
        TableName: 'test-audit-trail-table',
        KeyConditionExpression: 'pk = :pk',
        FilterExpression: 'actorEmail = :actorEmail',
        ExpressionAttributeValues: { ':pk': 'AUDIT', ':actorEmail': 'medewerker@nijmegen.nl' },
        ScanIndexForward: false,
      });
    });

    it('narrows the sk range to [since, until] when both are given', async () => {
      documentMock.on(QueryCommand).resolves({ Items: [] });

      await newAuditTrail().findByActor('medewerker@nijmegen.nl', 100, {
        since: '2026-01-01T00:00:00.000Z', until: '2026-01-31T23:59:59.999Z',
      });

      const call = documentMock.commandCalls(QueryCommand)[0];
      expect(call.args[0].input.KeyConditionExpression).toBe('pk = :pk AND sk BETWEEN :since AND :until');
      expect(call.args[0].input.ExpressionAttributeValues).toMatchObject({
        ':since': '2026-01-01T00:00:00.000Z',
        ':until': '2026-01-31T23:59:59.999Z#\uFFFF',
      });
    });

    it('narrows the sk range to only a lower bound when just since is given', async () => {
      documentMock.on(QueryCommand).resolves({ Items: [] });

      await newAuditTrail().findByActor('medewerker@nijmegen.nl', 100, { since: '2026-01-01T00:00:00.000Z' });

      const call = documentMock.commandCalls(QueryCommand)[0];
      expect(call.args[0].input.KeyConditionExpression).toBe('pk = :pk AND sk >= :since');
    });

    it('narrows the sk range to only an upper bound when just until is given', async () => {
      documentMock.on(QueryCommand).resolves({ Items: [] });

      await newAuditTrail().findByActor('medewerker@nijmegen.nl', 100, { until: '2026-01-31T23:59:59.999Z' });

      const call = documentMock.commandCalls(QueryCommand)[0];
      expect(call.args[0].input.KeyConditionExpression).toBe('pk = :pk AND sk <= :until');
    });

    it('applies a limit to the collected matches', async () => {
      // Newest first, as DynamoDB would already return them with ScanIndexForward: false.
      documentMock.on(QueryCommand).resolves({
        Items: [
          { ...validItem, eventId: EVENT_ID_2, occurredAt: '2026-01-02T00:00:00.000Z', actorEmail: 'medewerker@nijmegen.nl' },
          { ...validItem, eventId: EVENT_ID_1, actorEmail: 'medewerker@nijmegen.nl' },
        ],
      });

      const events = await newAuditTrail().findByActor('medewerker@nijmegen.nl', 1);

      expect(events.map((event) => event.eventId)).toEqual([EVENT_ID_2]);
    });

    it('returns an empty array when the actor has no events', async () => {
      documentMock.on(QueryCommand).resolves({ Items: [] });

      expect(await newAuditTrail().findByActor('medewerker-zonder-events@nijmegen.nl', 10)).toEqual([]);
    });

    it('uses a default limit of 100 when none is given', async () => {
      const items = Array.from({ length: 101 }, (_, index) => ({
        ...validItem,
        eventId: `${index}`,
        sk: `2026-01-01T00:00:00.${String(index).padStart(3, '0')}Z#${index}`,
        actorEmail: 'medewerker@nijmegen.nl',
      }));
      documentMock.on(QueryCommand).resolves({ Items: items });

      const events = await newAuditTrail().findByActor('medewerker@nijmegen.nl');

      expect(events).toHaveLength(100);
    });

    it('pages through LastEvaluatedKey until it has collected limit matches', async () => {
      documentMock.on(QueryCommand)
        .resolvesOnce({
          Items: [{ ...validItem, eventId: EVENT_ID_1, actorEmail: 'medewerker@nijmegen.nl' }],
          LastEvaluatedKey: { pk: 'AUDIT', sk: 'page-1' },
        })
        .resolvesOnce({
          Items: [{ ...validItem, eventId: EVENT_ID_2, occurredAt: '2026-01-02T00:00:00.000Z', actorEmail: 'medewerker@nijmegen.nl' }],
        });

      const events = await newAuditTrail().findByActor('medewerker@nijmegen.nl', 2);

      expect(events.map((event) => event.eventId)).toEqual([EVENT_ID_1, EVENT_ID_2]);
      expect(documentMock.commandCalls(QueryCommand)).toHaveLength(2);
      expect(documentMock.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey).toEqual({ pk: 'AUDIT', sk: 'page-1' });
    });
  });

  describe('mapping invalid records', () => {
    it('drops a record with a missing eventId/occurredAt', async () => {
      documentMock.on(QueryCommand).resolves({ Items: [{ pk: 'AUDIT', outcome: 'SUCCESS', correlationId: 'trace-1' }] });

      expect(await newAuditTrail().findLatest(10)).toEqual([]);
    });

    it('drops a record with an eventType outside the known set', async () => {
      documentMock.on(QueryCommand).resolves({ Items: [{ ...validItem, eventType: 'SOMETHING_ELSE' }] });

      expect(await newAuditTrail().findLatest(10)).toEqual([]);
    });

    it('drops a record with an invalid outcome instead of guessing one', async () => {
      documentMock.on(QueryCommand).resolves({ Items: [{ ...validItem, outcome: 'UNKNOWN' }] });

      expect(await newAuditTrail().findLatest(10)).toEqual([]);
    });

    it('drops a record with a non-string correlationId', async () => {
      documentMock.on(QueryCommand).resolves({ Items: [{ ...validItem, correlationId: 123 }] });

      expect(await newAuditTrail().findLatest(10)).toEqual([]);
    });

    it('drops a record whose metadata is not a flat string/number/boolean record', async () => {
      documentMock.on(QueryCommand).resolves({ Items: [{ ...validItem, metadata: { nested: { a: 1 } } }] });

      expect(await newAuditTrail().findLatest(10)).toEqual([]);
    });

    it('drops a record whose metadata value is not an object instead of an array', async () => {
      documentMock.on(QueryCommand).resolves({ Items: [{ ...validItem, metadata: ['not', 'an', 'object'] }] });

      expect(await newAuditTrail().findLatest(10)).toEqual([]);
    });

    it('keeps the valid records in a query result and drops only the invalid one', async () => {
      documentMock.on(QueryCommand).resolves({ Items: [validItem, { ...validItem, eventId: EVENT_ID_2, outcome: 'nonsense' }] });

      expect(await newAuditTrail().findLatest(10)).toEqual([validEvent]);
    });
  });
});
