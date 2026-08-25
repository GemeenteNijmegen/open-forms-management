import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { WoonbehoefteCaseRepository } from '../WoonbehoefteCaseRepository';

const documentMock = mockClient(DynamoDBDocumentClient);

function newRepository(): WoonbehoefteCaseRepository {
  return new WoonbehoefteCaseRepository(DynamoDBDocumentClient.from(new DynamoDBClient({})), 'test-woonbehoefte-cases-table');
}

function conditionalCheckFailed(): Error {
  return Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
}

function transactionCancelled(): Error {
  return Object.assign(new Error('Transaction cancelled'), { name: 'TransactionCanceledException' });
}

describe('WoonbehoefteCaseRepository', () => {
  beforeEach(() => {
    documentMock.reset();
  });

  it('creates a new case as NEW/unclaimed/version 1', async () => {
    documentMock.on(PutCommand).resolves({});

    const created = await newRepository().createCaseIfMissing('OF-ABC123', 'woonbehoefte-sync-worker', new Date('2026-08-24T10:00:00Z'));

    expect(created).toBe(true);
    const call = documentMock.commandCalls(PutCommand)[0];
    expect(call.args[0].input.Item).toMatchObject({
      pk: 'CASE#OF-ABC123', sk: 'CASE', caseReference: 'OF-ABC123', status: 'NEW', version: 1, check: { requested: false },
    });
    expect(call.args[0].input.Item?.claimedBy).toBeUndefined();
  });

  it('does not overwrite an existing case: a refresh must never touch case processing in progress', async () => {
    documentMock.on(PutCommand).rejects(conditionalCheckFailed());

    const created = await newRepository().createCaseIfMissing('OF-ABC123', 'woonbehoefte-sync-worker');

    expect(created).toBe(false);
  });

  it('creates the primary source link on first sight', async () => {
    documentMock.on(PutCommand).resolves({});

    const result = await newRepository().createPrimarySourceLinkIfMissing('OF-ABC123', 'uuid-1', 'OF-ABC123');

    expect(result).toBe('CREATED');
  });

  it('treats a repeated link to the same submissionId as idempotent, not a conflict', async () => {
    documentMock.on(PutCommand).rejects(conditionalCheckFailed());
    documentMock.on(GetCommand).resolves({ Item: { submissionId: 'uuid-1' } });

    const result = await newRepository().createPrimarySourceLinkIfMissing('OF-ABC123', 'uuid-1', 'OF-ABC123');

    expect(result).toBe('ALREADY_LINKED');
  });

  it('flags a link to a different submissionId as a conflict, without overwriting the existing link', async () => {
    documentMock.on(PutCommand).rejects(conditionalCheckFailed());
    documentMock.on(GetCommand).resolves({ Item: { submissionId: 'uuid-original' } });

    const result = await newRepository().createPrimarySourceLinkIfMissing('OF-ABC123', 'uuid-duplicate', 'OF-ABC123');

    expect(result).toBe('CONFLICT');
  });

  it('lists every case across paginated Scan pages, filtered to SK = CASE only', async () => {
    documentMock.on(ScanCommand)
      .resolvesOnce({ Items: [{ pk: 'CASE#OF-1', sk: 'CASE', caseReference: 'OF-1' }], LastEvaluatedKey: { pk: 'CASE#OF-1', sk: 'CASE' } })
      .resolvesOnce({ Items: [{ pk: 'CASE#OF-2', sk: 'CASE', caseReference: 'OF-2' }] });

    const cases = await newRepository().listCases();

    expect(cases.map((c) => c.caseReference)).toEqual(['OF-1', 'OF-2']);
    const call = documentMock.commandCalls(ScanCommand)[0];
    expect(call.args[0].input.FilterExpression).toBe('sk = :sk');
  });

  it('reads a single case by reference, or undefined when it does not exist', async () => {
    documentMock.on(GetCommand).resolvesOnce({ Item: { pk: 'CASE#OF-1', sk: 'CASE', caseReference: 'OF-1' } }).resolvesOnce({});

    await expect(newRepository().getCase('OF-1')).resolves.toMatchObject({ caseReference: 'OF-1' });
    await expect(newRepository().getCase('OF-missing')).resolves.toBeUndefined();
  });

  it('splits every item under a case partition into the case, source links, notes and activities', async () => {
    documentMock.on(QueryCommand).resolves({
      Items: [
        { pk: 'CASE#OF-1', sk: 'CASE', caseReference: 'OF-1' },
        { pk: 'CASE#OF-1', sk: 'SOURCE#PRIMARY', submissionId: 'uuid-1' },
        { pk: 'CASE#OF-1', sk: 'NOTE#2026-08-24T10:00:00.000Z#note-1', text: 'Contactmoment' },
        { pk: 'CASE#OF-1', sk: 'ACTIVITY#2026-08-24T10:00:00.000Z#activity-1', type: 'CASE_CREATED' },
      ],
    });

    const items = await newRepository().getCaseItems('OF-1');

    expect(items.woonbehoefteCase).toMatchObject({ caseReference: 'OF-1' });
    expect(items.sourceLinks).toHaveLength(1);
    expect(items.notes).toHaveLength(1);
    expect(items.activities).toHaveLength(1);
  });

  it('claiming a NEW case also moves it to IN_PROGRESS in the same transaction, guarded on claimedBy being absent', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    const result = await newRepository().claim('OF-1', 'medewerker@example.nl', 1, 'NEW');

    expect(result).toBe('OK');
    const call = documentMock.commandCalls(TransactWriteCommand)[0];
    const update = call.args[0].input.TransactItems?.[0].Update;
    expect(update?.ConditionExpression).toBe('#version = :expectedVersion AND (attribute_not_exists(#claimedBy))');
    expect(update?.ExpressionAttributeValues).toMatchObject({ ':expectedVersion': 1, ':newVersion': 2 });
    expect(update?.UpdateExpression).toMatch(/#status = :s\d/);
  });

  it('claim is refused server-side when the case is already claimed by someone else, regardless of what the UI offered', async () => {
    documentMock.on(TransactWriteCommand).rejects(transactionCancelled());

    const result = await newRepository().claim('OF-1', 'medewerker@example.nl', 1, 'IN_PROGRESS');

    expect(result).toBe('STALE_VERSION');
  });

  it('claiming an IN_PROGRESS case does not touch status', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    await newRepository().claim('OF-1', 'medewerker@example.nl', 3, 'IN_PROGRESS');

    const update = documentMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems?.[0].Update;
    expect(update?.UpdateExpression).not.toContain('#status');
  });

  it('a stale expectedVersion never applies the mutation: the whole transaction is cancelled', async () => {
    documentMock.on(TransactWriteCommand).rejects(transactionCancelled());

    const result = await newRepository().claim('OF-1', 'medewerker@example.nl', 1, 'NEW');

    expect(result).toBe('STALE_VERSION');
  });

  it('releasing removes claimedBy/claimedAt entirely, not just blanks them, guarded on being the actor\'s own claim', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    await newRepository().release('OF-1', 'medewerker@example.nl', 2);

    const update = documentMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems?.[0].Update;
    expect(update?.UpdateExpression).toContain('REMOVE #claimedBy, #claimedAt');
    expect(update?.ConditionExpression).toBe('#version = :expectedVersion AND (#claimedBy = :guardActor)');
    expect(update?.ExpressionAttributeValues).toMatchObject({ ':guardActor': 'medewerker@example.nl' });
  });

  it('takeover records the previous assignee in the activity change, guarded on someone else currently holding the claim', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    await newRepository().takeOver('OF-1', 'nieuw@example.nl', 2, 'oud@example.nl');

    const call = documentMock.commandCalls(TransactWriteCommand)[0];
    const update = call.args[0].input.TransactItems?.[0].Update;
    expect(update?.ConditionExpression).toBe('#version = :expectedVersion AND (attribute_exists(#claimedBy) AND #claimedBy <> :guardActor)');
    const activity = call.args[0].input.TransactItems?.[1].Put?.Item;
    expect(activity?.changes).toEqual([{ field: 'claimedBy', from: 'oud@example.nl', to: 'nieuw@example.nl' }]);
  });

  it('updates nested assessment fields with a dotted DynamoDB map path', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    await newRepository().updateAssessment('OF-1', 'medewerker@example.nl', 4, { set: { assessedStartPeriod: 202809 }, remove: [] }, [
      { field: 'assessment.assessedStartPeriod', to: 202809 },
    ]);

    const update = documentMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems?.[0].Update;
    expect(update?.UpdateExpression).toContain('#assessment.#assessedStartPeriod = :s0');
    expect(update?.ExpressionAttributeValues).toMatchObject({ ':s0': 202809 });
  });

  it('clearing an assessment field removes it instead of writing an empty value', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    await newRepository().updateAssessment('OF-1', 'medewerker@example.nl', 4, { set: {}, remove: ['assessedStartPeriod'] }, [
      { field: 'assessment.assessedStartPeriod', from: 202809 },
    ]);

    const update = documentMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems?.[0].Update;
    expect(update?.UpdateExpression).toContain('REMOVE #assessment.#assessedStartPeriod');
  });

  it('proposing inadmissible writes the required motivering as an immutable ADMISSIBILITY note in the same transaction', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    const result = await newRepository().proposeInadmissible('OF-1', 'medewerker@example.nl', 5, 'IN_PROGRESS', 'Geen geldige overeenkomst aangetoond');

    expect(result).toBe('OK');
    const items = documentMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems;
    expect(items).toHaveLength(3);
    const note = items?.[2].Put?.Item;
    expect(note).toMatchObject({ category: 'ADMISSIBILITY', text: 'Geen geldige overeenkomst aangetoond' });
  });

  it('confirmInadmissible sets status to INADMISSIBLE and closes an open check without faking an outcome', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    await newRepository().confirmInadmissible('OF-1', 'medewerker@example.nl', 5, true);

    const update = documentMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems?.[0].Update;
    expect(update?.ExpressionAttributeValues).toMatchObject({ ':s0': 'INADMISSIBLE' });
    expect(update?.UpdateExpression).toContain('#check.#requested = :s2');
    expect(update?.ExpressionAttributeValues).toMatchObject({ ':s2': false });
  });

  it('confirmInadmissible leaves the check untouched when none was open', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    await newRepository().confirmInadmissible('OF-1', 'medewerker@example.nl', 5, false);

    const update = documentMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems?.[0].Update;
    expect(update?.UpdateExpression).not.toContain('#check');
  });

  it('adds an immutable note together with a NOTE_ADDED activity, in one transaction', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    const note = await newRepository().addNote('OF-1', 'medewerker@example.nl', 'CONTACT', 'Gebeld met aanvrager');

    expect(note).toMatchObject({ caseReference: 'OF-1', category: 'CONTACT', text: 'Gebeld met aanvrager' });
    const items = documentMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems;
    expect(items?.[0].Put?.Item).toMatchObject({ text: 'Gebeld met aanvrager' });
    expect(items?.[1].Put?.Item).toMatchObject({ type: 'NOTE_ADDED', summary: 'Interne aantekening toegevoegd (Contact)' });
  });

  it('requestCheck writes the optional toelichting as a CHECK note in the same transaction as opening the check', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    const result = await newRepository().requestCheck('OF-1', 'medewerker@example.nl', 3, 'Controleer de BOPA');

    expect(result).toBe('OK');
    const items = documentMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems;
    expect(items).toHaveLength(3);
    expect(items?.[2].Put?.Item).toMatchObject({ category: 'CHECK', text: 'Controleer de BOPA' });
  });

  it('requestCheck without a toelichting writes no note', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    await newRepository().requestCheck('OF-1', 'medewerker@example.nl', 3, undefined);

    const items = documentMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems;
    expect(items).toHaveLength(2);
  });

  it('requestCheck without a toelichting removes a stale requestNoteId from an earlier check cycle', async () => {
    documentMock.on(TransactWriteCommand).resolves({});

    await newRepository().requestCheck('OF-1', 'medewerker@example.nl', 3, undefined);

    const update = documentMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems?.[0].Update;
    expect(update?.UpdateExpression).toMatch(/REMOVE .*#check\.#requestNoteId/);
  });
});
