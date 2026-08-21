import { FetchedSportCsvDocument } from './fetchSportCsvDocuments';
import { parseSportSubmission } from './parseSportSubmission';
import { SportSubmission } from './SportSubmission';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';

export interface SportSubmissionsResult {
  submissions: SportSubmission[];
  failedCount: number;
}

/**
 * Parses every fetched CSV into a SportSubmission, keeps only the districts the medewerker may see,
 * and sorts newest-first on the actual `Inzendingdatum`. A CSV that fails to parse is skipped and
 * counted, the same way `fetchSportCsvDocuments` counts a document that failed to download.
 */
export function buildSportSubmissions(documents: FetchedSportCsvDocument[], allowedDistricts: string[]): SportSubmissionsResult {
  const allowed = new Set(allowedDistricts);
  const submissions: SportSubmission[] = [];
  let failedCount = 0;

  for (const document of documents) {
    try {
      const submission = parseSportSubmission(document.csvText, document.reference);
      if (allowed.has(submission.district)) {
        submissions.push(submission);
      }
    } catch (error) {
      failedCount += 1;
      logger.warn('Sport submission skipped after a CSV parsing failure', { reason: errorReason(error) });
    }
  }

  submissions.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
  return { submissions, failedCount };
}
