/**
 * Start of the current sportseizoen (`YYYY-08-01`): 1 August of this calendar year once that date has
 * passed, otherwise 1 August of the previous year. Compared as a UTC instant, consistent with how
 * `parseSportSubmission` treats `Inzendingdatum`.
 */
export function currentSportSeasonStart(now: Date = new Date()): string {
  const augustFirstThisYear = Date.UTC(now.getUTCFullYear(), 7, 1);
  const seasonYear = now.getTime() >= augustFirstThisYear ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${seasonYear}-08-01`;
}
