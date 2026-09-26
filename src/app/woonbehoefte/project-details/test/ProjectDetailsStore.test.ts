import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { HousingLine } from '../domain/ProjectDetails';
import { NewWorkVersionInput, ProjectDetailsStore } from '../persistence/ProjectDetailsStore';

const documentMock = mockClient(DynamoDBDocumentClient);

function newStore(): ProjectDetailsStore {
  return new ProjectDetailsStore(DynamoDBDocumentClient.from(new DynamoDBClient({})), 'test-woonbehoefte-project-details-table');
}

function transactionCancelled(reasons: { Code?: string }[] = [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }]): Error {
  return Object.assign(new Error('Transaction cancelled'), { name: 'TransactionCanceledException', CancellationReasons: reasons });
}

function emptyWorkVersionInput(): NewWorkVersionInput {
  return {
    readableProjectName: 'Voorbeeldproject',
    projectDescription: 'Beschrijving',
    additionalInformation: '',
    projectWideNotes: '',
    housingLines: {},
    collectiveFacilityLines: {},
    kovaLines: {},
  };
}

function housingLine(overrides: Partial<HousingLine> = {}): HousingLine {
  return { lineId: 'line-1', order: 0, type: 'WOONHUIS', connectionCount: 1, connectionType: '3x25A', otherDetails: '', ...overrides };
}

describe('ProjectDetailsStore', () => {
  beforeEach(() => {
    documentMock.reset();
  });

  it('creates a werkversie together with an INITIALIZED history item in one transaction', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    const result = await newStore().createWorkVersionIfMissing('OF-1', emptyWorkVersionInput(), 'worker', new Date('2026-09-25T10:00:00Z'));

    expect(result).toBe('CREATED');
    const call = documentMock.commandCalls(TransactWriteCommand)[0];
    const [workVersionItem, historyItem] = call.args[0].input.TransactItems!;
    expect(workVersionItem.Put?.Item).toMatchObject({ pk: 'CASE#OF-1', sk: 'WORKVERSION', readableProjectName: 'Voorbeeldproject' });
    expect(workVersionItem.Put?.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(historyItem.Put?.Item).toMatchObject({ pk: 'CASE#OF-1', action: 'INITIALIZED' });
  });

  it('starts an empty werkversie with its own MANUALLY_STARTED history item, for a dossier whose bron blijvend kapot is', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    const result = await newStore().startEmptyWorkVersion('OF-1', 'medewerker@example.nl', new Date('2026-09-25T10:00:00Z'));

    expect(result).toBe('CREATED');
    const call = documentMock.commandCalls(TransactWriteCommand)[0];
    const [workVersionItem, historyItem] = call.args[0].input.TransactItems!;
    expect(workVersionItem.Put?.Item).toMatchObject({ pk: 'CASE#OF-1', sk: 'WORKVERSION', readableProjectName: '' });
    expect(workVersionItem.Put?.Item).not.toHaveProperty('sourceLocationPolygon');
    expect(workVersionItem.Put?.Item).not.toHaveProperty('sourceLocationIssue');
    expect(workVersionItem.Put?.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(historyItem.Put?.Item).toMatchObject({ pk: 'CASE#OF-1', action: 'MANUALLY_STARTED' });
  });

  it('stores a bronpolygon on the werkversie when the prefill input carries one', async () => {
    documentMock.on(TransactWriteCommand).resolves({});
    const polygon = { type: 'Polygon' as const, coordinates: [[[5.86, 51.85], [5.87, 51.85], [5.87, 51.86], [5.86, 51.85]]] };

    await newStore().createWorkVersionIfMissing('OF-1', { ...emptyWorkVersionInput(), sourceLocationPolygon: polygon }, 'worker');

    const call = documentMock.commandCalls(TransactWriteCommand)[0];
    const [workVersionItem] = call.args[0].input.TransactItems!;
    expect(workVersionItem.Put?.Item).toMatchObject({ sourceLocationPolygon: polygon });
  });

  it('never overwrites an existing werkversie: a repeated init is SKIPPED and writes nothing new', async () => {
    documentMock.on(TransactWriteCommand).rejects(transactionCancelled());

    const result = await newStore().createWorkVersionIfMissing('OF-1', emptyWorkVersionInput(), 'worker');

    expect(result).toBe('SKIPPED');
  });

  it('rethrows a cancellation that is not caused by our own conditional check, instead of reporting SKIPPED', async () => {
    documentMock.on(TransactWriteCommand).rejects(transactionCancelled([{ Code: 'None' }, { Code: 'ThroughputExceeded' }]));

    await expect(newStore().createWorkVersionIfMissing('OF-1', emptyWorkVersionInput(), 'worker')).rejects.toThrow();
  });

  it('reads the werkversie and the pogingstatus independently by GetItem', async () => {
    documentMock.on(GetCommand, { Key: { pk: 'CASE#OF-1', sk: 'WORKVERSION' } }).resolves({ Item: { caseReference: 'OF-1' } });
    documentMock.on(GetCommand, { Key: { pk: 'CASE#OF-1', sk: 'ATTEMPT' } }).resolves({ Item: { caseReference: 'OF-1', status: 'FAILED' } });

    const workVersion = await newStore().getWorkVersion('OF-1');
    const attempt = await newStore().getAttempt('OF-1');

    expect(workVersion).toMatchObject({ caseReference: 'OF-1' });
    expect(attempt).toMatchObject({ status: 'FAILED' });
  });

  it('overwrites the pogingstatus unconditionally, since a werkversie always takes precedence over it', async () => {
    documentMock.on(PutCommand).resolves({});

    await newStore().setAttempt('OF-1', 'FAILED', 'CSV_PARSE_ERROR', new Date('2026-09-25T10:00:00Z'));

    const call = documentMock.commandCalls(PutCommand)[0];
    expect(call.args[0].input.Item).toMatchObject({ pk: 'CASE#OF-1', sk: 'ATTEMPT', status: 'FAILED', failureReasonCode: 'CSV_PARSE_ERROR' });
    expect(call.args[0].input.ConditionExpression).toBeUndefined();
  });

  it('updates project fields only when a werkversie already exists, and records PROJECT_UPDATED history in the same transaction', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    const result = await newStore().updateProject('OF-1', 'Nieuwe naam', 'Nieuwe toelichting', 'medewerker@example.nl');

    expect(result).toBe('OK');
    const call = documentMock.commandCalls(TransactWriteCommand)[0];
    const [update, history] = call.args[0].input.TransactItems!;
    expect(update.Update?.ConditionExpression).toBe('attribute_exists(pk)');
    expect(update.Update?.ExpressionAttributeValues).toMatchObject({ ':f0': 'Nieuwe naam', ':f1': 'Nieuwe toelichting' });
    expect(history.Put?.Item).toMatchObject({ action: 'PROJECT_UPDATED' });
  });

  it('returns NOT_FOUND when a project update targets a case without a werkversie, writing nothing', async () => {
    documentMock.on(TransactWriteCommand).rejects(transactionCancelled());

    const result = await newStore().updateProject('OF-1', 'Naam', 'Toelichting', 'medewerker@example.nl');

    expect(result).toBe('NOT_FOUND');
  });

  it('stores a manual polygon and records LOCATION_ADDED when isNew, without touching sourceLocationPolygon', async () => {
    documentMock.on(TransactWriteCommand).resolves({});
    const polygon = { type: 'Polygon' as const, coordinates: [[[5.86, 51.85], [5.87, 51.85], [5.87, 51.86], [5.86, 51.85]]] };

    const result = await newStore().setManualLocation('OF-1', polygon, true, 'medewerker@example.nl', new Date('2026-09-25T10:00:00Z'));

    expect(result).toBe('OK');
    const call = documentMock.commandCalls(TransactWriteCommand)[0];
    const [update, history] = call.args[0].input.TransactItems!;
    expect(update.Update?.ConditionExpression).toBe('attribute_exists(pk)');
    expect(update.Update?.ExpressionAttributeValues).toMatchObject({ ':manualLocationPolygon': polygon, ':manualLocationSetBy': 'medewerker@example.nl' });
    expect(update.Update?.ExpressionAttributeValues).not.toHaveProperty(':sourceLocationPolygon');
    expect(history.Put?.Item).toMatchObject({ action: 'LOCATION_ADDED' });
  });

  it('records LOCATION_REPLACED instead of LOCATION_ADDED when isNew is false', async () => {
    documentMock.on(TransactWriteCommand).resolves({});
    const polygon = { type: 'Polygon' as const, coordinates: [[[5.86, 51.85], [5.87, 51.85], [5.87, 51.86], [5.86, 51.85]]] };

    await newStore().setManualLocation('OF-1', polygon, false, 'medewerker@example.nl');

    const call = documentMock.commandCalls(TransactWriteCommand)[0];
    const [, history] = call.args[0].input.TransactItems!;
    expect(history.Put?.Item).toMatchObject({ action: 'LOCATION_REPLACED' });
  });

  it('returns NOT_FOUND when setManualLocation targets a case without a werkversie, writing nothing', async () => {
    documentMock.on(TransactWriteCommand).rejects(transactionCancelled());
    const polygon = { type: 'Polygon' as const, coordinates: [[[5.86, 51.85], [5.87, 51.85], [5.87, 51.86], [5.86, 51.85]]] };

    const result = await newStore().setManualLocation('OF-1', polygon, true, 'medewerker@example.nl');

    expect(result).toBe('NOT_FOUND');
  });

  it('rethrows a cancellation on a project update that is not caused by our own conditional check', async () => {
    documentMock.on(TransactWriteCommand).rejects(transactionCancelled([{ Code: 'ThroughputExceeded' }, { Code: 'None' }]));

    await expect(newStore().updateProject('OF-1', 'Naam', 'Toelichting', 'medewerker@example.nl')).rejects.toThrow();
  });

  it('adds a new line under a stable lineId, guarding against overwriting an id that already exists', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    const result = await newStore().upsertLine('OF-1', 'WONEN', housingLine(), true, 'medewerker@example.nl');

    expect(result).toBe('OK');
    const call = documentMock.commandCalls(TransactWriteCommand)[0];
    const [update, history] = call.args[0].input.TransactItems!;
    expect(update.Update?.ConditionExpression).toBe('attribute_exists(pk) AND attribute_not_exists(#category.#lineId)');
    expect(update.Update?.ExpressionAttributeNames).toMatchObject({ '#category': 'housingLines', '#lineId': 'line-1' });
    expect(history.Put?.Item).toMatchObject({ action: 'LINE_CREATED', category: 'WONEN', lineId: 'line-1' });
  });

  it('updates an existing line only, guarding against silently creating a line from a wrong id', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    const result = await newStore().upsertLine('OF-1', 'WONEN', housingLine({ otherDetails: 'gewijzigd' }), false, 'medewerker@example.nl');

    expect(result).toBe('OK');
    const call = documentMock.commandCalls(TransactWriteCommand)[0];
    const [update, history] = call.args[0].input.TransactItems!;
    expect(update.Update?.ConditionExpression).toBe('attribute_exists(#category.#lineId)');
    expect(history.Put?.Item).toMatchObject({ action: 'LINE_UPDATED' });
  });

  it('a wrong lineId on update writes nothing and reports NOT_FOUND', async () => {
    documentMock.on(TransactWriteCommand).rejects(transactionCancelled());

    const result = await newStore().upsertLine('OF-1', 'WONEN', housingLine({ lineId: 'onbekend' }), false, 'medewerker@example.nl');

    expect(result).toBe('NOT_FOUND');
  });

  it('deletes a line and records LINE_DELETED history atomically', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    const result = await newStore().deleteLine('OF-1', 'KOVA', 'line-9', 'medewerker@example.nl');

    expect(result).toBe('OK');
    const call = documentMock.commandCalls(TransactWriteCommand)[0];
    const [update, history] = call.args[0].input.TransactItems!;
    expect(update.Update?.UpdateExpression).toBe('REMOVE #category.#lineId SET #updatedAt = :updatedAt, #updatedBy = :updatedBy');
    expect(history.Put?.Item).toMatchObject({ action: 'LINE_DELETED', category: 'KOVA', lineId: 'line-9' });
  });

  it('a wrong lineId on delete writes nothing and reports NOT_FOUND', async () => {
    documentMock.on(TransactWriteCommand).rejects(transactionCancelled());

    const result = await newStore().deleteLine('OF-1', 'KOVA', 'onbekend', 'medewerker@example.nl');

    expect(result).toBe('NOT_FOUND');
  });

  it('rethrows a cancellation on a delete that is not caused by our own conditional check', async () => {
    documentMock.on(TransactWriteCommand).rejects(transactionCancelled([{ Code: 'ThroughputExceeded' }, { Code: 'None' }]));

    await expect(newStore().deleteLine('OF-1', 'KOVA', 'line-9', 'medewerker@example.nl')).rejects.toThrow();
  });
});
