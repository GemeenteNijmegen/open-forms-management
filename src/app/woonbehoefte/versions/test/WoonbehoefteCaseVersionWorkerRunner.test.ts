import { DynamoDBRecord } from 'aws-lambda';
import { RawCaseImage } from '../WoonbehoefteCaseVersionStore';
import { CaseVersionWriter, processWoonbehoefteCaseVersionRecord } from '../WoonbehoefteCaseVersionWorkerRunner';

function caseImage(version: number, caseReference = 'OF-2026-00142'): RawCaseImage {
  return {
    pk: { S: `CASE#${caseReference}` },
    sk: { S: 'CASE' },
    caseReference: { S: caseReference },
    version: { N: String(version) },
  };
}

function record(overrides: Partial<DynamoDBRecord> & { dynamodb: DynamoDBRecord['dynamodb'] }): DynamoDBRecord {
  return { eventID: 'event-1', ...overrides };
}

function newWriter(): jest.Mocked<CaseVersionWriter> {
  return { putVersion: jest.fn().mockResolvedValue('CREATED') };
}

const NOW = new Date('2026-08-25T10:00:00.000Z');

describe('processWoonbehoefteCaseVersionRecord', () => {
  it('saves the NEW image on INSERT', async () => {
    const writer = newWriter();
    const newImage = caseImage(1);

    await processWoonbehoefteCaseVersionRecord(
      record({ eventName: 'INSERT', dynamodb: { Keys: { pk: newImage.pk, sk: newImage.sk }, NewImage: newImage } }),
      writer, NOW,
    );

    expect(writer.putVersion).toHaveBeenCalledTimes(1);
    expect(writer.putVersion).toHaveBeenCalledWith(newImage, expect.objectContaining({ eventName: 'INSERT', imageSource: 'NEW' }));
  });

  it('saves OLD before NEW on MODIFY', async () => {
    const writer = newWriter();
    const oldImage = caseImage(1);
    const newImage = caseImage(2);

    await processWoonbehoefteCaseVersionRecord(
      record({ eventName: 'MODIFY', dynamodb: { Keys: { pk: newImage.pk, sk: newImage.sk }, OldImage: oldImage, NewImage: newImage } }),
      writer, NOW,
    );

    expect(writer.putVersion).toHaveBeenCalledTimes(2);
    expect(writer.putVersion.mock.calls[0]).toEqual([oldImage, expect.objectContaining({ eventName: 'MODIFY', imageSource: 'OLD' })]);
    expect(writer.putVersion.mock.calls[1]).toEqual([newImage, expect.objectContaining({ eventName: 'MODIFY', imageSource: 'NEW' })]);
  });

  it.each(['NOTE#2026-08-25T10:00:00.000Z#note-1', 'ACTIVITY#2026-08-25T10:00:00.000Z#activity-1', 'SOURCE#PRIMARY'])(
    'ignores non-CASE records (sk = %s)',
    async (sk) => {
      const writer = newWriter();

      await processWoonbehoefteCaseVersionRecord(
        record({ eventName: 'MODIFY', dynamodb: { Keys: { pk: { S: 'CASE#OF-2026-00142' }, sk: { S: sk } } } }),
        writer, NOW,
      );

      expect(writer.putVersion).not.toHaveBeenCalled();
    },
  );

  it('saves the OLD image on REMOVE', async () => {
    const writer = newWriter();
    const oldImage = caseImage(7);

    await processWoonbehoefteCaseVersionRecord(
      record({ eventName: 'REMOVE', dynamodb: { Keys: { pk: oldImage.pk, sk: oldImage.sk }, OldImage: oldImage } }),
      writer, NOW,
    );

    expect(writer.putVersion).toHaveBeenCalledTimes(1);
    expect(writer.putVersion).toHaveBeenCalledWith(oldImage, expect.objectContaining({ eventName: 'REMOVE', imageSource: 'OLD' }));
  });

  it('rejects an INSERT record without a NewImage', async () => {
    const writer = newWriter();

    await expect(processWoonbehoefteCaseVersionRecord(
      record({ eventName: 'INSERT', dynamodb: { Keys: { pk: { S: 'CASE#OF-2026-00142' }, sk: { S: 'CASE' } } } }),
      writer, NOW,
    )).rejects.toThrow();
    expect(writer.putVersion).not.toHaveBeenCalled();
  });

  it('rejects a MODIFY record without an OldImage/NewImage', async () => {
    const writer = newWriter();
    const newImage = caseImage(2);

    await expect(processWoonbehoefteCaseVersionRecord(
      record({ eventName: 'MODIFY', dynamodb: { Keys: { pk: newImage.pk, sk: newImage.sk }, NewImage: newImage } }),
      writer, NOW,
    )).rejects.toThrow();
    expect(writer.putVersion).not.toHaveBeenCalled();
  });

  it('saves both snapshots on a version gap instead of failing the record', async () => {
    const writer = newWriter();
    const oldImage = caseImage(7);
    const newImage = caseImage(9);

    await expect(processWoonbehoefteCaseVersionRecord(
      record({ eventName: 'MODIFY', dynamodb: { Keys: { pk: newImage.pk, sk: newImage.sk }, OldImage: oldImage, NewImage: newImage } }),
      writer, NOW,
    )).resolves.toBeUndefined();

    expect(writer.putVersion).toHaveBeenCalledTimes(2);
  });
});
