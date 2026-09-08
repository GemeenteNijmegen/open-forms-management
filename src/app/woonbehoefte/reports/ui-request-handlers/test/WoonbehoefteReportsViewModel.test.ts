import { WoonbehoefteReport, WoonbehoefteReportStatus } from '../../domain/WoonbehoefteReport';
import { buildWoonbehoefteReportsListViewModel } from '../WoonbehoefteReportsViewModel';

const filter = { statuses: [], startYears: [], startYearNotSet: false, applicantTypes: [], assignment: 'ALL' as const, checkRequestedOnly: false };

function report(status: WoonbehoefteReportStatus): WoonbehoefteReport {
  return {
    reportId: `report-${status}`,
    filter,
    options: { includeAllFormFields: false, includeAttachmentFilenames: false },
    status,
    requestedBy: 'medewerker@nijmegen.nl',
    requestedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
}

describe('buildWoonbehoefteReportsListViewModel status colors', () => {
  it.each([
    ['QUEUED', 'report-building'],
    ['BUILDING', 'report-building'],
    ['READY', 'report-ready'],
    ['TOO_LARGE', 'report-failed'],
    ['FAILED', 'report-failed'],
  ] as const)('gives status %s the badge variant %s', (status, variant) => {
    const [item] = buildWoonbehoefteReportsListViewModel([report(status)]).reports;
    expect(item.statusVariant).toBe(variant);
  });
});
