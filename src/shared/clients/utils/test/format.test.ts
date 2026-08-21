import { isValidIsoDate, isValidUuid } from '../format';

describe('isValidUuid', () => {
  it('accepts a valid UUID regardless of case', () => {
    expect(isValidUuid('c48c6597-8034-4a10-9885-eb5a0863a61d')).toBe(true);
    expect(isValidUuid('C48C6597-8034-4A10-9885-EB5A0863A61D')).toBe(true);
  });

  it('rejects a non-UUID string', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('')).toBe(false);
  });
});

describe('isValidIsoDate', () => {
  it('accepts a YYYY-MM-DD date', () => {
    expect(isValidIsoDate('2026-08-20')).toBe(true);
  });

  it('rejects a differently formatted or invalid date', () => {
    expect(isValidIsoDate('20-08-2026')).toBe(false);
    expect(isValidIsoDate('not-a-date')).toBe(false);
    expect(isValidIsoDate('2026-08-20T10:00:00Z')).toBe(false);
  });
});
