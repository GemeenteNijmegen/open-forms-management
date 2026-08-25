import { AttributeValue, DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

export type CaseVersionImageSource = 'NEW' | 'OLD';

export interface CaseVersionMetadata {
  eventId: string;
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  imageSource: CaseVersionImageSource;
  recordedAt: string;
  approximateCreationDateTime?: number;
}

export type PutCaseVersionResult = 'CREATED' | 'ALREADY_EXISTS';

export type RawCaseImage = Record<string, AttributeValue>;

export function caseVersionSortKey(version: number): string {
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new Error('Invalid Woonbehoefte case version');
  }
  return `VERSION#${String(version).padStart(12, '0')}`;
}

function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

function stringAttribute(image: RawCaseImage, name: string): string | undefined {
  return image[name]?.S;
}

function numberAttribute(image: RawCaseImage, name: string): number | undefined {
  const value = image[name]?.N;
  return value === undefined ? undefined : Number(value);
}

/**
 * Writes a raw DynamoDB CASE image as one immutable version snapshot, nested under `snapshot` rather than
 * flattened, so the version item's own keys/metadata can never collide with a CASE attribute. Put-only,
 * conditioned on the version not existing yet: duplicate stream delivery is an idempotent no-op, never an
 * overwrite.
 */
export class WoonbehoefteCaseVersionStore {
  constructor(private readonly client: DynamoDBClient, private readonly tableName: string) { }

  async putVersion(image: RawCaseImage, metadata: CaseVersionMetadata): Promise<PutCaseVersionResult> {
    const pk = stringAttribute(image, 'pk');
    const sk = stringAttribute(image, 'sk');
    const caseReference = stringAttribute(image, 'caseReference');
    const version = numberAttribute(image, 'version');

    if (sk !== 'CASE') {
      throw new Error('Woonbehoefte case image has an unexpected sk');
    }
    if (!caseReference || pk !== `CASE#${caseReference}`) {
      throw new Error('Woonbehoefte case image pk does not match its caseReference');
    }
    if (version === undefined || !Number.isSafeInteger(version) || version <= 0) {
      throw new Error('Woonbehoefte case image has an invalid version');
    }

    try {
      await this.client.send(new PutItemCommand({
        TableName: this.tableName,
        Item: {
          pk: { S: pk },
          sk: { S: caseVersionSortKey(version) },
          caseReference: { S: caseReference },
          version: { N: String(version) },
          snapshotRecordedAt: { S: metadata.recordedAt },
          snapshotEventId: { S: metadata.eventId },
          snapshotEventName: { S: metadata.eventName },
          snapshotImageSource: { S: metadata.imageSource },
          ...(metadata.approximateCreationDateTime !== undefined
            ? { snapshotSourceAt: { N: String(metadata.approximateCreationDateTime) } }
            : {}),
          snapshot: { M: image },
        },
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
      }));
      return 'CREATED';
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        return 'ALREADY_EXISTS';
      }
      throw error;
    }
  }
}
