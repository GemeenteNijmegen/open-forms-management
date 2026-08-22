import { parseSportReportRow } from './parseSportReportRow';
import { SportReportRow } from './SportReportRow';
import { errorReason } from '../../../../observability/errorReason';
import { logger } from '../../../../observability/Logger';
import { FetchedSportCsvDocument } from '../../fetchSportCsvDocuments';
import { SportDistrict } from '../../SportDistrictAuthorization';

/**
 * Maps every fetched CSV document to a full report row and keeps only the requested districts. A CSV
 * that fails to parse throws immediately: a report is never READY with rows silently missing.
 */
export function buildSportReportRows(documents: FetchedSportCsvDocument[], districts: SportDistrict[]): SportReportRow[] {
  const requestedDistricts = new Set<string>(districts);
  const rows: SportReportRow[] = [];

  for (const document of documents) {
    let row: SportReportRow;
    try {
      row = parseSportReportRow(document.csvText, document.reference);
    } catch (error) {
      logger.warn('Sport report row build failed', {
        reference: document.reference,
        objectUuid: document.objectUuid,
        documentUrl: document.documentUrl,
        reason: errorReason(error),
      });
      throw error;
    }
    if (requestedDistricts.has(row.district)) {
      rows.push(row);
    }
  }

  return rows;
}
