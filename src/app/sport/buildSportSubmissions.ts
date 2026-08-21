import { FetchedSportCsvDocument } from './fetchSportCsvDocuments';
import { parseSportSubmission } from './parseSportSubmission';
import { SportAanmeldType, SportSubmission } from './SportSubmission';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';

export interface SportSubmissionsResult {
  submissions: SportSubmission[];
  failedCount: number;
}

// A CSV that fails to parse is skipped and counted, the same way fetchSportCsvDocuments counts a
// document that failed to download.
export function buildSportSubmissions(
  documents: FetchedSportCsvDocument[],
  allowedDistricts: string[],
  allowedTypes: SportAanmeldType[],
): SportSubmissionsResult {
  const allowed = new Set(allowedDistricts);
  const allowedAanmeldTypes = new Set(allowedTypes);
  const submissions: SportSubmission[] = [];
  let failedCount = 0;

  for (const document of documents) {
    try {
      const submission = parseSportSubmission(document.csvText, document.reference);
      if (allowed.has(submission.district) && allowedAanmeldTypes.has(submission.aanmeldType)) {
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
