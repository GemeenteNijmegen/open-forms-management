import { resolveReportDateRange, resolveReportDistricts } from '../SportReportRequestValidation';

describe('resolveReportDistricts', () => {
  it('rejects an empty selection', () => {
    expect(resolveReportDistricts([], ['dukenburg', 'lindenholt'])).toBeUndefined();
  });

  it('rejects the whole request when one requested district is not allowed, not just that district', () => {
    expect(resolveReportDistricts(['dukenburg', 'nijmegenNoord'], ['dukenburg'])).toBeUndefined();
  });

  it('returns the canonical, deterministically sorted set when every requested district is allowed', () => {
    expect(resolveReportDistricts(['lindenholt', 'dukenburg'], ['dukenburg', 'lindenholt', 'nijmegenNoord']))
      .toEqual(['dukenburg', 'lindenholt']);
  });
});

describe('resolveReportDateRange', () => {
  it('rejects a non-ISO date', () => {
    expect(resolveReportDateRange('01-01-2026', '2026-01-31')).toBeUndefined();
  });

  it('rejects from after to', () => {
    expect(resolveReportDateRange('2026-02-01', '2026-01-01')).toBeUndefined();
  });

  it('accepts a valid range, from equal to to included', () => {
    expect(resolveReportDateRange('2026-01-01', '2026-01-01')).toEqual({ from: '2026-01-01', to: '2026-01-01' });
  });
});
