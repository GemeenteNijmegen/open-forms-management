// Increasing ISO timestamps, so ordering assertions don't depend on the real clock.
export function sequentialTimestamps(start = '2026-01-01T00:00:00.000Z', stepMs = 1000): () => string {
  let current = new Date(start).getTime();
  return () => {
    const iso = new Date(current).toISOString();
    current += stepMs;
    return iso;
  };
}
