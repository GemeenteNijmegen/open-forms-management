import { errorReason } from '../../../../observability/errorReason';
import { logger } from '../../../../observability/Logger';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { OpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClient';
import { WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { isReadySource } from '../../domain/WoonbehoefteSource';
import { WoonbehoefteSourceCacheStore } from '../../source/WoonbehoefteSourceCacheStore';
import { ProjectDetailsStore } from '../persistence/ProjectDetailsStore';
import { buildProjectDetailsPrefill } from '../source/buildProjectDetailsPrefill';
import { parseProjectDetailsCsv } from '../source/ProjectDetailsCsvParser';

export interface ProjectDetailsInitializationDependencies {
  caseRepository: WoonbehoefteCaseRepository;
  sourceCacheStore: WoonbehoefteSourceCacheStore;
  openZaakClient: OpenZaakClient;
  store: ProjectDetailsStore;
}

// De worker leest/schrijft op eigen naam, niet namens de medewerker wiens klik de batch startte.
export const PROJECT_DETAILS_WORKER_ACTOR: EmployeeIdentity = { principalId: 'woonbehoefte-project-details-worker' };

export type InitializeCaseResult = 'CREATED' | 'SKIPPED' | 'FAILED';

/** Beste-poging FAILED-registratie: als de store zelf ook faalt mag dat dit dossier niet alsnog laten crashen. */
async function trySetFailed(deps: ProjectDetailsInitializationDependencies, caseReference: string, reasonCode: string, now: Date): Promise<void> {
  try {
    await deps.store.setAttempt(caseReference, 'FAILED', reasonCode, now);
  } catch (error) {
    logger.error('Projectdetails: FAILED-status kon niet worden weggeschreven', { caseReference, reason: errorReason(error) });
  }
}

/**
 * Handelt één dossier af, zowel vanuit de batch als vanuit de losse retry-knop op de detailpagina. Bestaat
 * er al een werkversie, dan gebeurt er niets: geen CSV-fetch, geen schrijfactie. Elke fout onderweg
 * (bronlink ontbreekt, cache-leesfout, kapotte CSV, storefout) zet dit ene dossier op FAILED en geeft dat
 * terug. Deze functie gooit zelf nooit iets, zodat één stuk dossier de rest van een batch niet meesleurt.
 */
export async function initializeCase(
  caseReference: string, deps: ProjectDetailsInitializationDependencies, now: Date = new Date(),
): Promise<InitializeCaseResult> {
  try {
    const existing = await deps.store.getWorkVersion(caseReference);
    if (existing) {
      return 'SKIPPED';
    }

    await deps.store.setAttempt(caseReference, 'PENDING', undefined, now);

    const sourceLinks = await deps.caseRepository.getSourceLinks(caseReference);
    const primaryLink = sourceLinks.find((link) => link.relation === 'PRIMARY');
    if (!primaryLink) {
      logger.warn('Projectdetails: geen primary source-link voor dossier', { caseReference });
      await trySetFailed(deps, caseReference, 'MISSING_SOURCE_LINK', now);
      return 'FAILED';
    }

    const sourceItems = await deps.sourceCacheStore.getItems([primaryLink.submissionId]);
    const sourceItem = sourceItems.get(primaryLink.submissionId);
    if (!sourceItem || !isReadySource(sourceItem) || !sourceItem.csvDocument) {
      await trySetFailed(deps, caseReference, 'MISSING_SOURCE_CSV', now);
      return 'FAILED';
    }

    let csvText: string;
    try {
      csvText = await deps.openZaakClient.getDocumentText(sourceItem.csvDocument.url, PROJECT_DETAILS_WORKER_ACTOR);
    } catch (error) {
      logger.warn('Projectdetails: CSV-fetch mislukt', { caseReference, reason: errorReason(error) });
      await trySetFailed(deps, caseReference, 'CSV_FETCH_ERROR', now);
      return 'FAILED';
    }

    try {
      const csvData = parseProjectDetailsCsv(csvText, caseReference);
      const prefill = buildProjectDetailsPrefill(csvData);
      const result = await deps.store.createWorkVersionIfMissing(caseReference, prefill, PROJECT_DETAILS_WORKER_ACTOR.principalId, now);
      return result === 'CREATED' ? 'CREATED' : 'SKIPPED';
    } catch (error) {
      logger.warn('Projectdetails: CSV kon niet worden geparsed', { caseReference, reason: errorReason(error) });
      await trySetFailed(deps, caseReference, 'CSV_PARSE_ERROR', now);
      return 'FAILED';
    }
  } catch (error) {
    logger.error('Projectdetails: dossier onverwacht mislukt', { caseReference, reason: errorReason(error) });
    await trySetFailed(deps, caseReference, 'UNEXPECTED_ERROR', now);
    return 'FAILED';
  }
}

const BATCH_CONCURRENCY = 4;

export interface ProjectDetailsBatchOutcome {
  created: number;
  skipped: number;
  failed: number;
  cutoffReached: boolean;
}

/**
 * Loopt alle bestaande dossiers langs (geen Objects-scan, gewoon de Cases-tabel), met dezelfde kleine
 * vaste concurrency als de andere Woonbehoefte-batches. Elk dossier is op zichzelf idempotent, dus een
 * hervatte batch na een cutoff pakt gewoon verder waar hij was gebleven; er is geen aparte cursor nodig
 * om bij te houden waar de vorige run stopte.
 *
 * De batchstatus wordt voor en na de run weggeschreven, zodat het overzicht kan laten zien of de laatste
 * run alles gehad heeft of halverwege is afgebroken, en of iemand 'm nog een keer moet starten.
 */
export async function runProjectDetailsBatch(
  deps: ProjectDetailsInitializationDependencies, isPastCutoff: () => boolean, runId: string, now: Date = new Date(),
): Promise<ProjectDetailsBatchOutcome> {
  const cases = await deps.caseRepository.listCases();
  await deps.store.recordBatchState({ runId, status: 'RUNNING', startedAt: now.toISOString() });

  const outcome: ProjectDetailsBatchOutcome = { created: 0, skipped: 0, failed: 0, cutoffReached: false };
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < cases.length) {
      if (isPastCutoff()) {
        outcome.cutoffReached = true;
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      const result = await initializeCase(cases[index].caseReference, deps);
      if (result === 'CREATED') {
        outcome.created += 1;
      } else if (result === 'SKIPPED') {
        outcome.skipped += 1;
      } else {
        outcome.failed += 1;
      }
    }
  }

  const workerCount = Math.min(BATCH_CONCURRENCY, cases.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const status = outcome.cutoffReached ? 'CUTOFF' : outcome.failed > 0 ? 'READY_WITH_ERRORS' : 'READY';
  await deps.store.recordBatchState({
    runId,
    status,
    startedAt: now.toISOString(),
    completedAt: new Date().toISOString(),
    created: outcome.created,
    skipped: outcome.skipped,
    failed: outcome.failed,
  });

  logger.info('Projectdetails batch afgerond', { runId, casesCount: cases.length, ...outcome });
  return outcome;
}
