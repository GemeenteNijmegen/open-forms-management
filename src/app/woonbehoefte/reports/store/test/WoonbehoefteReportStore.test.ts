import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { WoonbehoefteReport } from '../../domain/WoonbehoefteReport';
import { WoonbehoefteReportFilter } from '../../filters/WoonbehoefteReportFilter';
import { WoonbehoefteReportStore } from '../WoonbehoefteReportStore';

const documentMock = mockClient(DynamoDBDocumentClient);

function newStore() {
  return new WoonbehoefteReportStore(DynamoDBDocumentClient.from(new DynamoDBClient({})), 'test-woonbehoefte-reports-table');
}

const filter: WoonbehoefteReportFilter = {
  statuses: [], startYears: [], startYearNotSet: false, applicantTypes: [], assignment: 'ALL', checkRequestedOnly: false,
};
const options = { includeAllFormFields: false, includeAttachmentFilenames: false };

function report(overrides: Partial<WoonbehoefteReport> = {}): WoonbehoefteReport {
  return {
    reportId: 'report-1',
    filter,
    options,
    status: 'READY',
    requestedBy: 'medewerker@nijmegen.nl',
    requestedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

describe('WoonbehoefteReportStore', () => {
  beforeEach(() => {
    documentMock.reset();
  });

  it('creates a QUEUED report with a ~30-day TTL', async () => {
    documentMock.on(PutCommand).resolves({});

    const created = await newStore().createQueued({ filter, options, requestedBy: 'medewerker@nijmegen.nl' });

    expect(created.status).toBe('QUEUED');
    expect(created.filter).toEqual(filter);
    expect(created.options).toEqual(options);
    expect(created.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) + 29 * 24 * 60 * 60);

    const call = documentMock.commandCalls(PutCommand)[0];
    expect(call.args[0].input).toMatchObject({
      TableName: 'test-woonbehoefte-reports-table',
      ConditionExpression: 'attribute_not_exists(reportId)',
    });
  });

  it('gets a report by id, or undefined when it does not exist', async () => {
    documentMock.on(GetCommand).resolves({ Item: report() });
    await expect(newStore().get('report-1')).resolves.toEqual(report());

    documentMock.on(GetCommand).resolves({});
    await expect(newStore().get('missing')).resolves.toBeUndefined();
  });

  it('lists recent reports newest-first, hiding DELETED and expired ones', async () => {
    documentMock.on(ScanCommand).resolves({
      Items: [
        report({ reportId: 'old', requestedAt: '2026-01-01T00:00:00.000Z' }),
        report({ reportId: 'new', requestedAt: '2026-01-02T00:00:00.000Z' }),
        report({ reportId: 'deleted', status: 'DELETED', requestedAt: '2026-01-03T00:00:00.000Z' }),
        report({ reportId: 'expired', expiresAt: Math.floor(Date.now() / 1000) - 1, requestedAt: '2026-01-03T00:00:00.000Z' }),
      ],
    });

    const reports = await newStore().listRecent();

    expect(reports.map((r) => r.reportId)).toEqual(['new', 'old']);
  });

  it('finds the active report matching the same filter and options, ignoring finished/expired ones', async () => {
    const recentUpdatedAt = new Date().toISOString();
    const otherFilter: WoonbehoefteReportFilter = { ...filter, statuses: ['NEW'] };
    documentMock.on(ScanCommand).resolves({
      Items: [
        report({ reportId: 'other-filter', status: 'QUEUED', filter: otherFilter, updatedAt: recentUpdatedAt }),
        report({ reportId: 'finished', status: 'READY' }),
        report({ reportId: 'match', status: 'BUILDING', filter, options, updatedAt: recentUpdatedAt }),
      ],
    });

    const match = await newStore().findMatchingActive(filter, options);

    expect(match?.reportId).toBe('match');
  });

  it('does not match an active report with the same filter but different options', async () => {
    documentMock.on(ScanCommand).resolves({
      Items: [report({
        reportId: 'other-options', status: 'QUEUED', filter, options: { ...options, includeAllFormFields: true }, updatedAt: new Date().toISOString(),
      })],
    });

    await expect(newStore().findMatchingActive(filter, options)).resolves.toBeUndefined();
  });

  it('lets the worker claim a QUEUED report for building, but a duplicate claim on the same report loses the race', async () => {
    documentMock.on(UpdateCommand).resolvesOnce({}).rejectsOnce(
      Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' }),
    );

    const store = newStore();
    await expect(store.claimForBuilding('report-1')).resolves.toBe(true);
    await expect(store.claimForBuilding('report-1')).resolves.toBe(false);

    const call = documentMock.commandCalls(UpdateCommand)[0];
    expect(call.args[0].input).toMatchObject({
      ConditionExpression: '#status = :requiredStatus',
      ExpressionAttributeValues: expect.objectContaining({ ':requiredStatus': 'QUEUED', ':status': 'BUILDING' }),
    });
  });

  it('does not overwrite a report that already moved past BUILDING when a late duplicate tries to mark it READY', async () => {
    documentMock.on(UpdateCommand).rejects(
      Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' }),
    );

    await expect(newStore().markReady('report-1', 'reports/report-1.xlsx', 3, 0)).resolves.toBe(false);
  });

  it('fails a report that is still QUEUED when the worker invocation itself failed to start', async () => {
    documentMock.on(UpdateCommand).resolves({});

    await expect(newStore().markQueuedFailed('report-1', 'WORKER_START_ERROR')).resolves.toBe(true);

    const call = documentMock.commandCalls(UpdateCommand)[0];
    expect(call.args[0].input).toMatchObject({
      ConditionExpression: '#status = :requiredStatus',
      ExpressionAttributeValues: expect.objectContaining({
        ':requiredStatus': 'QUEUED', ':status': 'FAILED', ':failureReason': 'WORKER_START_ERROR',
      }),
    });
  });

  it('fails a stale QUEUED report that never got claimed, but leaves a recently queued one alone', async () => {
    const staleUpdatedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const recentUpdatedAt = new Date().toISOString();
    documentMock.on(ScanCommand).resolves({
      Items: [
        report({ reportId: 'stale-queued', status: 'QUEUED', updatedAt: staleUpdatedAt }),
        report({ reportId: 'recent-queued', status: 'QUEUED', updatedAt: recentUpdatedAt }),
      ],
    });
    documentMock.on(UpdateCommand).resolves({});

    const reports = await newStore().listRecent();

    expect(reports.find((r) => r.reportId === 'stale-queued')).toMatchObject({ status: 'FAILED', failureReason: 'WORKER_NOT_STARTED' });
    expect(reports.find((r) => r.reportId === 'recent-queued')).toMatchObject({ status: 'QUEUED' });
  });

  it('fails a stale BUILDING report whose heartbeat went silent, but a recent touchBuilding() heartbeat keeps one alive', async () => {
    const staleUpdatedAt = new Date(Date.now() - 21 * 60 * 1000).toISOString();
    const recentUpdatedAt = new Date().toISOString();
    documentMock.on(ScanCommand).resolves({
      Items: [
        report({ reportId: 'stale-building', status: 'BUILDING', updatedAt: staleUpdatedAt }),
        report({ reportId: 'recent-building', status: 'BUILDING', updatedAt: recentUpdatedAt }),
      ],
    });
    documentMock.on(UpdateCommand).resolves({});

    const reports = await newStore().listRecent();

    expect(reports.find((r) => r.reportId === 'stale-building')).toMatchObject({ status: 'FAILED', failureReason: 'WORKER_STALLED' });
    expect(reports.find((r) => r.reportId === 'recent-building')).toMatchObject({ status: 'BUILDING' });
  });

  it('marks a report DELETED idempotently: deleting an already-deleted report is a no-op success', async () => {
    documentMock.on(UpdateCommand).resolvesOnce({}).rejectsOnce(
      Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' }),
    );

    const store = newStore();
    await expect(store.markDeleted('report-1')).resolves.toBe(true);
    await expect(store.markDeleted('report-1')).resolves.toBe(false);
  });
});
