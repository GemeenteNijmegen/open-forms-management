import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { SportReport } from '../SportReport';
import { SportReportStore } from '../SportReportStore';

const documentMock = mockClient(DynamoDBDocumentClient);

function newStore() {
  return new SportReportStore(DynamoDBDocumentClient.from(new DynamoDBClient({})), 'test-sport-reports-table');
}

function report(overrides: Partial<SportReport> = {}): SportReport {
  return {
    reportId: 'report-1',
    districts: ['dukenburg'],
    from: '2026-01-01',
    to: '2026-01-31',
    status: 'READY',
    requestedBy: 'medewerker@nijmegen.nl',
    requestedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

describe('SportReportStore', () => {
  beforeEach(() => {
    documentMock.reset();
  });

  it('creates a QUEUED report with canonically sorted districts and a ~30-day TTL', async () => {
    documentMock.on(PutCommand).resolves({});

    const created = await newStore().createQueued({
      districts: ['lindenholt', 'dukenburg'],
      from: '2026-01-01',
      to: '2026-01-31',
      requestedBy: 'medewerker@nijmegen.nl',
    });

    expect(created.status).toBe('QUEUED');
    expect(created.districts).toEqual(['dukenburg', 'lindenholt']);
    expect(created.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) + 29 * 24 * 60 * 60);

    const call = documentMock.commandCalls(PutCommand)[0];
    expect(call.args[0].input).toMatchObject({
      TableName: 'test-sport-reports-table',
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

  it('finds the active report matching the same canonical district set and date range, ignoring order/finished/expired ones', async () => {
    const recentUpdatedAt = new Date().toISOString();
    documentMock.on(ScanCommand).resolves({
      Items: [
        report({ reportId: 'other-range', status: 'QUEUED', to: '2026-02-28', updatedAt: recentUpdatedAt }),
        report({ reportId: 'finished', status: 'READY' }),
        report({ reportId: 'match', status: 'BUILDING', districts: ['lindenholt', 'dukenburg'], updatedAt: recentUpdatedAt }),
      ],
    });

    const match = await newStore().findMatchingActive(['dukenburg', 'lindenholt'], '2026-01-01', '2026-01-31');

    expect(match?.reportId).toBe('match');
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

    await expect(newStore().markReady('report-1', 'reports/report-1.xlsx', 3)).resolves.toBe(false);
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

  it('does not fail a stale-looking report if its heartbeat updated between the read and the cleanup transition', async () => {
    const staleUpdatedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    documentMock.on(ScanCommand).resolves({
      Items: [report({ reportId: 'report-1', status: 'BUILDING', updatedAt: staleUpdatedAt })],
    });
    // Simulates touchBuilding() having bumped updatedAt in DynamoDB after cleanup already read the report.
    documentMock.on(UpdateCommand).rejects(
      Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' }),
    );

    const reports = await newStore().listRecent();

    expect(reports.find((r) => r.reportId === 'report-1')).toMatchObject({ status: 'BUILDING', updatedAt: staleUpdatedAt });
  });
});
