import { SPORT_OVERVIEW_PAGE_SIZE } from '../sportdata/SportOverviewPolicy';
import { SportSubmission } from '../sportdata/SportSubmission';

/** Newest-first order: `objectUuid` only makes the DynamoDB key unique, it carries no sort meaning. */
export function sortNewestFirst(submissions: SportSubmission[]): SportSubmission[] {
  return [...submissions].sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
}

export interface SportSubmissionsPage {
  submissions: SportSubmission[];
  totalCount: number;
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * Pages already-authorized, already-filtered submissions: `cursor` is the `submittedAt` of the last
 * submission shown on the previous page. Technical only, never a permission carrier - it's applied after
 * permissions/filtering already narrowed the set, so a manipulated cursor can only skip around within what
 * the medewerker could already see, never surface anything else.
 */
export function paginateSportSubmissions(submissions: SportSubmission[], cursor?: string): SportSubmissionsPage {
  const sorted = sortNewestFirst(submissions);
  const cursorTime = cursor ? new Date(cursor).getTime() : undefined;
  const afterCursor = cursorTime !== undefined ? sorted.filter((submission) => submission.submittedAt.getTime() < cursorTime) : sorted;
  const page = afterCursor.slice(0, SPORT_OVERVIEW_PAGE_SIZE);
  const hasMore = afterCursor.length > SPORT_OVERVIEW_PAGE_SIZE;

  return {
    submissions: page,
    totalCount: sorted.length,
    hasMore,
    ...(hasMore ? { nextCursor: page[page.length - 1].submittedAt.toISOString() } : {}),
  };
}
