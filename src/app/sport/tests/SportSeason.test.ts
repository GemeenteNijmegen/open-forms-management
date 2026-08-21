import { currentSportSeasonStart } from '../SportSeason';

describe('currentSportSeasonStart', () => {
  it('uses 1 August of the current year on the season start date itself', () => {
    expect(currentSportSeasonStart(new Date('2026-08-01T00:00:00Z'))).toBe('2026-08-01');
  });

  it('uses 1 August of the previous year just before the season starts', () => {
    expect(currentSportSeasonStart(new Date('2026-07-31T23:59:59Z'))).toBe('2025-08-01');
  });

  it('uses 1 August of the current year well into the season', () => {
    expect(currentSportSeasonStart(new Date('2026-12-15T00:00:00Z'))).toBe('2026-08-01');
  });
});
