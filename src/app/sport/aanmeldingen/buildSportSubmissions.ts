import { errorReason } from '../../../observability/errorReason';
import { logger } from '../../../observability/Logger';
import { FailedSportDocument, FetchedSportCsvDocument } from '../sportdata/fetchSportCsvDocuments';
import { parseSportSubmission } from '../sportdata/parseSportSubmission';
import { SportAanmeldType, SportSubmission } from '../sportdata/SportSubmission';

export interface SportSubmissionsResult {
  submissions: SportSubmission[];
  failedCount: number;
  failedDocuments: FailedSportDocument[];
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
  const failedDocuments: FailedSportDocument[] = [];
  let failedCount = 0;

  for (const document of documents) {
    try {
      const submission = parseSportSubmission(document.csvText, document.reference);
      if (allowed.has(submission.district) && allowedAanmeldTypes.has(submission.aanmeldType)) {
        submissions.push({ ...submission, objectUuid: document.objectUuid, hasPdf: document.hasPdf });
      }
    } catch (error) {
      failedCount += 1;
      failedDocuments.push({ reference: document.reference, objectUuid: document.objectUuid });
      logger.warn('Sport submission skipped after a CSV parsing failure', {
        reference: document.reference,
        objectUuid: document.objectUuid,
        documentUrl: document.documentUrl,
        reason: errorReason(error),
      });
    }
  }

  submissions.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
  return { submissions, failedCount, failedDocuments };
}
