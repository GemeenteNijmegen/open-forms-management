import { sequentialTimestamps } from './clock';

test('returns increasing ISO timestamps starting at the given moment', () => {
  const now = sequentialTimestamps('2026-01-01T00:00:00.000Z', 1000);

  expect(now()).toBe('2026-01-01T00:00:00.000Z');
  expect(now()).toBe('2026-01-01T00:00:01.000Z');
  expect(now()).toBe('2026-01-01T00:00:02.000Z');
});
