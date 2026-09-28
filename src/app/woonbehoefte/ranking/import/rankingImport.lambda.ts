import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Context } from 'aws-lambda';
import { errorReason } from '../../../../observability/errorReason';
import { logger } from '../../../../observability/Logger';
import { bindRequestLogging, resetRequestLogging } from '../../../../observability/RequestLogging';
import { xRayTraceId } from '../../../../observability/xRayTraceId';
import { createAuditTrail } from '../../../../shared/audit/createAuditTrail';
import { recordAudit } from '../../../../shared/audit/recordAudit';
import { createRankingStore } from '../createRankingStore';

export interface RankingImportEvent {
  orderedCaseReferences: string[];
}

const RANKING_IMPORT_ACTOR = 'ranking-import';

const dynamoDBClient = new DynamoDBClient({});
const rankingStore = createRankingStore(dynamoDBClient);
const auditTrail = createAuditTrail(dynamoDBClient);

// Direct-invoke only, never reachable through the management API: an operator's invoke response carries
// the outcome directly, there is no HTTP caller to redirect or render a page for. Protection is IAM (who
// may invoke this function) plus RankingStore.initialize()'s own conditional write, nothing more.
export async function handler(event: RankingImportEvent, context: Context): Promise<'ALREADY_INITIALIZED' | 'INITIALIZED'> {
  bindRequestLogging(context);
  try {
    const result = await rankingStore.initialize(event.orderedCaseReferences, RANKING_IMPORT_ACTOR);
    if (result === 'ALREADY_INITIALIZED') {
      logger.warn('Ranking import skipped: ranking already initialized, nothing overwritten');
      return 'ALREADY_INITIALIZED';
    }

    await recordAudit(auditTrail, {
      eventType: 'WOONBEHOEFTE_RANKING_IMPORTED',
      outcome: 'SUCCESS',
      correlationId: xRayTraceId(),
      resource: 'woonbehoefte-ranking',
      action: 'import',
      actorEmail: RANKING_IMPORT_ACTOR,
      metadata: { total: event.orderedCaseReferences.length },
    });
    return 'INITIALIZED';
  } catch (error) {
    logger.error('Ranking import failed unexpectedly', { reason: errorReason(error) });
    throw error;
  } finally {
    resetRequestLogging();
  }
}
