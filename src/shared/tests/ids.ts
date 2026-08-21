// Predictable ids, so assertions don't need expect.any(String).
export function sequentialIds(prefix = 'test-id'): () => string {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}
