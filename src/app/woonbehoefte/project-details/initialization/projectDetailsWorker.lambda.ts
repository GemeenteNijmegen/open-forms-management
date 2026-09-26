import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Context } from 'aws-lambda';
import { initializeCase, runProjectDetailsBatch } from './ProjectDetailsInitializationRunner';
import { errorReason } from '../../../../observability/errorReason';
import { logger } from '../../../../observability/Logger';
import { bindRequestLogging, resetRequestLogging } from '../../../../observability/RequestLogging';
import { getOpenZaakClient } from '../../../../shared/clients/open-zaak/OpenZaakClientFactory';
import { createWoonbehoefteCaseRepository } from '../../cases/createWoonbehoefteCaseRepository';
import { createWoonbehoefteSourceCacheStore } from '../../source/createWoonbehoefteSourceCacheStore';
import { createProjectDetailsStore } from '../persistence/createProjectDetailsStore';

/** `caseReference` gezet: dezelfde initializer voor de detailknop op één dossier. Ontbrekend: de volledige batch vanaf het overzicht. */
export interface ProjectDetailsWorkerEvent {
  runId: string;
  triggerCorrelationId: string;
  caseReference?: string;
}

// Zelfde marge-aanpak als de andere Woonbehoefte-workers: ruim voor het 900s-hard-timeout van Lambda zelf.
const CUTOFF_SAFETY_MARGIN_MS = 2 * 60 * 1000;

const dynamoDBClient = new DynamoDBClient({});
const caseRepository = createWoonbehoefteCaseRepository(dynamoDBClient);
const sourceCacheStore = createWoonbehoefteSourceCacheStore(dynamoDBClient);
const store = createProjectDetailsStore(dynamoDBClient);

export async function handler(event: ProjectDetailsWorkerEvent, context: Context): Promise<void> {
  bindRequestLogging(context);
  try {
    const openZaakClient = await getOpenZaakClient();
    const deps = { caseRepository, sourceCacheStore, openZaakClient, store };
    if (event.caseReference) {
      await initializeCase(event.caseReference, deps);
    } else {
      await runProjectDetailsBatch(deps, () => context.getRemainingTimeInMillis() <= CUTOFF_SAFETY_MARGIN_MS, event.runId);
    }
  } catch (error) {
    logger.error('ProjectDetailsWorker failed unexpectedly', { runId: event.runId, caseReference: event.caseReference, reason: errorReason(error) });
  } finally {
    resetRequestLogging();
  }
}
