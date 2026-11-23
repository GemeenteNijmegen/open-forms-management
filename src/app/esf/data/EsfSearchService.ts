import { z } from 'zod';
import { logger } from '../../../observability/Logger';
import { ObjectsClient } from '../../../shared/clients/objects/ObjectsClient';
import { ObjectResource } from '../../../shared/clients/objects/ObjectsResponse';

export const ESF_SEARCH_TYPES = ['clientnummer', 'dossiernummer'] as const;
export type EsfSearchType = typeof ESF_SEARCH_TYPES[number];

export interface EsfSearchRequest {
  periodenummer: string;
  searchType: EsfSearchType;
  searchValue: string;
}

export interface EsfTaskRecord {
  index: number;
  status?: string;
  registrationAt?: string;
}

export interface EsfTask {
  objectUuid: string;
  periodenummer: string;
  clientnummer: string;
  dossiernummer: string;
  records: EsfTaskRecord[];
}

export type EsfSearchResult =
  | { outcome: 'FOUND'; tasks: EsfTask[] }
  | { outcome: 'NOT_FOUND' };

// z.object drops every other field, so nothing else from record.data reaches the view.
const esfTaskDataSchema = z.object({
  soort: z.literal('formtaak'),
  formtaak: z.object({
    data: z.object({
      periodenummer: z.string(),
      clientnummer: z.string(),
      dossiernummer: z.string(),
    }),
  }),
});

type EsfTaskData = z.infer<typeof esfTaskDataSchema>;

// The period of an ESF task never changes, so a history record only contributes its status, shown as received.
const esfHistoryDataSchema = z.object({ status: z.string().optional() }).catch({});

export class EsfSearchService {
  constructor(private readonly client: ObjectsClient, private readonly objectTypeUrl: string) { }

  async search(request: EsfSearchRequest): Promise<EsfSearchResult> {
    const objects = await this.client.collectObjects({
      type: this.objectTypeUrl,
      dataFilters: [
        { path: ['soort'], operator: 'exact', value: 'formtaak' },
        { path: ['formtaak', 'data', 'periodenummer'], operator: 'exact', value: request.periodenummer },
        { path: ['formtaak', 'data', request.searchType], operator: 'exact', value: request.searchValue },
      ],
    });

    const matching = objects
      .map((object) => ({ object, data: this.matchingTaskData(object, request) }))
      .filter((match): match is { object: ObjectResource & { uuid: string }; data: EsfTaskData } => match.data !== undefined)
      .sort((a, b) => a.object.uuid.localeCompare(b.object.uuid));

    if (matching.length === 0) {
      return { outcome: 'NOT_FOUND' };
    }

    const tasks = await Promise.all(matching.map(({ object, data }) => this.taskWithHistory(object.uuid, data)));
    return { outcome: 'FOUND', tasks };
  }

  private matchingTaskData(object: ObjectResource, request: EsfSearchRequest): EsfTaskData | undefined {
    const parsed = esfTaskDataSchema.safeParse(object.record.data);
    const matches = object.type === this.objectTypeUrl
      && object.uuid !== undefined
      && parsed.success
      && parsed.data.formtaak.data.periodenummer === request.periodenummer
      && parsed.data.formtaak.data[request.searchType] === request.searchValue;
    if (!matches) {
      logger.warn('ESF object skipped: does not match the search after the API filter', { objectUuid: object.uuid });
      return undefined;
    }
    return parsed.data;
  }

  private async taskWithHistory(uuid: string, current: EsfTaskData): Promise<EsfTask> {
    const history = await this.client.getObjectHistory(uuid);
    const records = [...history].sort((a, b) => a.index - b.index).map((record): EsfTaskRecord => ({
      index: record.index,
      status: esfHistoryDataSchema.parse(record.data).status,
      registrationAt: record.registrationAt,
    }));
    logger.debug('ESF task history read', { objectUuid: uuid, recordCount: records.length });
    return {
      objectUuid: uuid,
      periodenummer: current.formtaak.data.periodenummer,
      clientnummer: current.formtaak.data.clientnummer,
      dossiernummer: current.formtaak.data.dossiernummer,
      records,
    };
  }
}
