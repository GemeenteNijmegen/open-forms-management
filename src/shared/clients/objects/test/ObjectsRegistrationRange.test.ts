import { requireValidRange, resolveRangeOrdering } from '../ObjectsRegistrationRange';

describe('requireValidRange', () => {
  it('accepts a valid from/to range', () => {
    expect(() => requireValidRange({ from: '2026-08-01', to: '2026-08-20' })).not.toThrow();
  });

  it('accepts from-only and to-only ranges', () => {
    expect(() => requireValidRange({ from: '2026-08-01' })).not.toThrow();
    expect(() => requireValidRange({ to: '2026-08-20' })).not.toThrow();
  });

  it('rejects an invalid from date', () => {
    expect(() => requireValidRange({ from: 'not-a-date' })).toThrow('ISO date');
  });

  it('rejects an invalid to date', () => {
    expect(() => requireValidRange({ to: 'not-a-date' })).toThrow('ISO date');
  });

  it('rejects from after to', () => {
    expect(() => requireValidRange({ from: '2026-08-20', to: '2026-08-01' })).toThrow('must not be after');
  });
});

describe('resolveRangeOrdering', () => {
  it('defaults to descending registrationAt when no ordering is given', () => {
    expect(resolveRangeOrdering(undefined)).toEqual([{ path: ['record', 'registrationAt'], direction: 'desc' }]);
  });

  it('accepts a caller ordering that already starts with descending registrationAt', () => {
    const ordering = [{ path: ['record', 'registrationAt'], direction: 'desc' as const }, { path: ['record', 'index'] }];

    expect(resolveRangeOrdering(ordering)).toEqual(ordering);
  });

  it('rejects an ordering that does not start with descending registrationAt', () => {
    expect(() => resolveRangeOrdering({ path: ['uuid'] })).toThrow('registrationRange requires ordering');
  });

  it('rejects an ascending registrationAt primary field', () => {
    expect(() => resolveRangeOrdering({ path: ['record', 'registrationAt'] })).toThrow('registrationRange requires ordering');
  });
});
