import { canonicalDistricts, isReportAvailable, SportReport } from '../SportReport';

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

describe('canonicalDistricts', () => {
  it('sorts to the fixed district order regardless of input order, and dedupes', () => {
    expect(canonicalDistricts(['lindenholt', 'dukenburg', 'lindenholt'])).toEqual(['dukenburg', 'lindenholt']);
  });
});

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
