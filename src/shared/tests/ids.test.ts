import { sequentialIds } from './ids';

test('returns increasing ids starting at 1', () => {
  const nextId = sequentialIds('event');

  expect(nextId()).toBe('event-1');
  expect(nextId()).toBe('event-2');
  expect(nextId()).toBe('event-3');
});
