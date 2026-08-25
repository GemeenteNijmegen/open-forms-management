import type { DynamoDBRecord } from 'aws-lambda';
import { CaseVersionMetadata, PutCaseVersionResult, RawCaseImage } from './WoonbehoefteCaseVersionStore';
import { logger } from '../../../observability/Logger';

export interface CaseVersionWriter {
  putVersion(image: RawCaseImage, metadata: CaseVersionMetadata): Promise<PutCaseVersionResult>;
}

// aws-lambda's stream AttributeValue and the SDK v3 client's AttributeValue are structurally close but not
// the same type; this is the one place that bridges them.
function streamImage(image: NonNullable<DynamoDBRecord['dynamodb']>['NewImage']): RawCaseImage {
  return image as unknown as RawCaseImage;
}

function caseVersion(image: RawCaseImage): number {
  return Number(image.version?.N);
}

/**
 * Processes one Cases-table stream record. Only `sk = CASE` records are versioned; notes, activities and
 * source links are cheap no-ops here. MODIFY always saves OLD before NEW, so a case that already had a
 * version before the stream was enabled gets its pre-mutation baseline, and a retry after a partial
 * failure still ends up with both snapshots.
 */
export async function processWoonbehoefteCaseVersionRecord(
  record: DynamoDBRecord, store: CaseVersionWriter, now: Date = new Date(),
): Promise<void> {
  if (record.dynamodb?.Keys?.sk?.S !== 'CASE') {
    return;
  }

  const eventId = record.eventID ?? '';
  const recordedAt = now.toISOString();
  const approximateCreationDateTime = record.dynamodb.ApproximateCreationDateTime;

  if (record.eventName === 'INSERT') {
    if (!record.dynamodb.NewImage) {
      throw new Error('Woonbehoefte case INSERT record is missing its NewImage');
    }
    await store.putVersion(streamImage(record.dynamodb.NewImage), {
      eventId, eventName: 'INSERT', imageSource: 'NEW', recordedAt, approximateCreationDateTime,
    });
  } else if (record.eventName === 'MODIFY') {
    if (!record.dynamodb.OldImage || !record.dynamodb.NewImage) {
      throw new Error('Woonbehoefte case MODIFY record is missing its OldImage/NewImage');
    }
    const oldImage = streamImage(record.dynamodb.OldImage);
    const newImage = streamImage(record.dynamodb.NewImage);
    const oldVersion = caseVersion(oldImage);
    const newVersion = caseVersion(newImage);
    if (newVersion !== oldVersion + 1) {
      // Not a permanent retry problem: both snapshots are still individually valid, so they're saved anyway.
      logger.warn('Woonbehoefte case version gap between stream images', {
        caseReference: newImage.caseReference?.S, oldVersion, newVersion, eventId,
      });
    }
    await store.putVersion(oldImage, { eventId, eventName: 'MODIFY', imageSource: 'OLD', recordedAt, approximateCreationDateTime });
    await store.putVersion(newImage, { eventId, eventName: 'MODIFY', imageSource: 'NEW', recordedAt, approximateCreationDateTime });
  } else if (record.eventName === 'REMOVE') {
    if (!record.dynamodb.OldImage) {
      throw new Error('Woonbehoefte case REMOVE record is missing its OldImage');
    }
    await store.putVersion(streamImage(record.dynamodb.OldImage), {
      eventId, eventName: 'REMOVE', imageSource: 'OLD', recordedAt, approximateCreationDateTime,
    });
  }
}
