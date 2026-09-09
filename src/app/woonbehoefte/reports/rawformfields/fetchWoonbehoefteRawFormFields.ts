import { parseWoonbehoefteRawFormRow, WoonbehoefteRawFormRow } from './WoonbehoefteRawFormFields';
import { errorReason } from '../../../../observability/errorReason';
import { logger } from '../../../../observability/Logger';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { WoonbehoefteCaseWithSource } from '../../overview/WoonbehoefteOverviewViewModel';

const CONCURRENCY = 4;

export interface RawFormFieldsOutcome {
  fields?: WoonbehoefteRawFormRow;
  /** Set only on an actual fetch/parse failure, never for a case that simply has no primary CSV to fetch. */
  warning?: string;
}

/**
 * Fetches and parses the primary CSV for every case that has one, with the same small fixed concurrency
 * fetchWoonbehoefteCsvDocuments/fetchSportCsvDocuments use. A case without a source or without a cached
 * csvDocument reference is skipped silently: the missing-source Bronwaarschuwing already covers that case.
 * A per-case fetch/parse failure never throws to the caller - it becomes a warning, the rest of the report
 * still builds. The CSV body itself is never logged, only the failing caseReference/reason.
 */
export async function fetchWoonbehoefteRawFormFields(
  client: OpenZaakClient, entries: WoonbehoefteCaseWithSource[], actor: EmployeeIdentity,
): Promise<Map<string, RawFormFieldsOutcome>> {
  const targets = entries
    .filter((entry) => Boolean(entry.source?.csvDocument))
    .map((entry) => ({ caseReference: entry.woonbehoefteCase.caseReference, csvUrl: entry.source!.csvDocument!.url }));

  const result = new Map<string, RawFormFieldsOutcome>();
  let nextIndex = 0;

  async function fetchOne(index: number): Promise<void> {
    const target = targets[index];
    try {
      const csvText = await client.getDocumentText(target.csvUrl, actor);
      result.set(target.caseReference, { fields: parseWoonbehoefteRawFormRow(csvText) });
    } catch (error) {
      logger.warn('Woonbehoefte raw form fields fetch failed', { caseReference: target.caseReference, reason: errorReason(error) });
      result.set(target.caseReference, { warning: 'Originele formulierdata kon niet worden geladen.' });
    }
  }

  async function worker(): Promise<void> {
    while (nextIndex < targets.length) {
      const index = nextIndex;
      nextIndex += 1;
      await fetchOne(index);
    }
  }

  const workerCount = Math.min(CONCURRENCY, targets.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return result;
}
