import { sportOverviewVisibleFrom, sportSubmissionExpiresAt, SPORT_OVERVIEW_MIN_HISTORY_DAYS } from '../SportOverviewPolicy';

describe('sportOverviewVisibleFrom', () => {
  it('still overlaps into the previous season just before 1 August', () => {
    const visibleFrom = sportOverviewVisibleFrom(new Date('2026-07-31T12:00:00Z'), 30);
    expect(visibleFrom.toISOString()).toBe('2025-08-01T00:00:00.000Z');
  });

  it('overlaps into the previous season on 1 August itself', () => {
    const visibleFrom = sportOverviewVisibleFrom(new Date('2026-08-01T00:00:00Z'), 30);
    expect(visibleFrom.toISOString()).toBe('2026-07-02T00:00:00.000Z');
  });

  it('still overlaps one day before the rolling window reaches the season start', () => {
    const visibleFrom = sportOverviewVisibleFrom(new Date('2026-08-30T00:00:00Z'), 30);
    expect(visibleFrom.toISOString()).toBe('2026-07-31T00:00:00.000Z');
    expect(visibleFrom.getTime()).toBeLessThan(new Date('2026-08-01T00:00:00Z').getTime());
  });

  it('settles on the season start exactly once the rolling window reaches it', () => {
    const visibleFrom = sportOverviewVisibleFrom(new Date('2026-08-31T00:00:00Z'), 30);
    expect(visibleFrom.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('uses the default minHistoryDays constant when none is given', () => {
    const withDefault = sportOverviewVisibleFrom(new Date('2026-08-20T12:00:00Z'));
    const withExplicitConstant = sportOverviewVisibleFrom(new Date('2026-08-20T12:00:00Z'), SPORT_OVERVIEW_MIN_HISTORY_DAYS);
    expect(withDefault.getTime()).toBe(withExplicitConstant.getTime());
  });

  it('reaches further back with a larger minHistoryDays', () => {
    const visibleFrom = sportOverviewVisibleFrom(new Date('2026-08-20T12:00:00Z'), 60);
    expect(visibleFrom.toISOString()).toBe('2026-06-21T12:00:00.000Z');
  });
});

describe('sportSubmissionExpiresAt', () => {
  it('expires a submission from earlier in the season at the start of the next season', () => {
    const expiresAt = sportSubmissionExpiresAt(new Date('2026-01-15T10:00:00Z'), 30);
    expect(expiresAt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('keeps a late-July submission visible into the new season through the overlap window', () => {
    const expiresAt = sportSubmissionExpiresAt(new Date('2026-07-31T09:00:00Z'), 30);
    expect(expiresAt.toISOString()).toBe('2026-08-30T09:00:00.000Z');
  });
});
