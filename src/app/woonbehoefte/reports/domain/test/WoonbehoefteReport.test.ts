import { WoonbehoefteReportFilter } from '../../filters/WoonbehoefteReportFilter';
import { isReportAvailable, WoonbehoefteReport } from '../WoonbehoefteReport';

const filter: WoonbehoefteReportFilter = {
  statuses: [], startYears: [], startYearNotSet: false, applicantTypes: [], assignment: 'ALL', checkRequestedOnly: false,
};

function report(overrides: Partial<WoonbehoefteReport> = {}): WoonbehoefteReport {
  return {
    reportId: 'report-1',
    filter,
    options: { includeAllFormFields: false, includeAttachmentFilenames: false },
    status: 'READY',
    requestedBy: 'medewerker@nijmegen.nl',
    requestedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

describe('isReportAvailable', () => {
  it('is available when not deleted and not yet expired', () => {
    expect(isReportAvailable(report())).toBe(true);
  });

  it('is not available once DELETED', () => {
    expect(isReportAvailable(report({ status: 'DELETED' }))).toBe(false);
  });

  it('is not available once its TTL has passed, even if DynamoDB has not purged it yet', () => {
    expect(isReportAvailable(report({ expiresAt: Math.floor(Date.now() / 1000) - 1 }))).toBe(false);
  });
});
