import { currentSportSeasonStart } from './SportSeason';

/** Overlap window right after 1 August during which the previous season's last submissions stay visible. */
export const SPORT_OVERVIEW_MIN_HISTORY_DAYS = 30;

/** Records per Sportpagina list page; `Meer tonen` requests the next page of this size. */
export const SPORT_OVERVIEW_PAGE_SIZE = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Earliest `submittedAt`/`registrationAt` that stays visible on the Sportpagina: the current sportseizoen
 * start, or `minHistoryDays` ago if that's earlier. Right after 1 August this still reaches back into the
 * previous season; `minHistoryDays` after that it settles on the season start itself. Used both to bound
 * the worker's Objects query and to filter the cache read, so the two never drift apart.
 */
export function sportOverviewVisibleFrom(now: Date = new Date(), minHistoryDays: number = SPORT_OVERVIEW_MIN_HISTORY_DAYS): Date {
  const seasonStart = new Date(`${currentSportSeasonStart(now)}T00:00:00Z`);
  const rollingStart = new Date(now.getTime() - minHistoryDays * MS_PER_DAY);
  return seasonStart < rollingStart ? seasonStart : rollingStart;
}

/**
 * Last moment a submission can still fall within `sportOverviewVisibleFrom`: the start of the season
 * following its own `submittedAt`, or `submittedAt + minHistoryDays` if that's later (the same overlap
 * window that keeps a late-July submission visible into the new season). Doubles as the cache TTL.
 */
export function sportSubmissionExpiresAt(submittedAt: Date, minHistoryDays: number = SPORT_OVERVIEW_MIN_HISTORY_DAYS): Date {
  const submissionSeasonStart = new Date(`${currentSportSeasonStart(submittedAt)}T00:00:00Z`);
  const nextSeasonStart = new Date(Date.UTC(submissionSeasonStart.getUTCFullYear() + 1, 7, 1));
  const rollingExpiry = new Date(submittedAt.getTime() + minHistoryDays * MS_PER_DAY);
  return nextSeasonStart > rollingExpiry ? nextSeasonStart : rollingExpiry;
}
