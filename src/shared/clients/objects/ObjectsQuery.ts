import { isValidIsoDate } from '../utils/format';

export type DataFilterOperator = 'exact' | 'gt' | 'gte' | 'lt' | 'lte' | 'icontains' | 'in';

export interface DataAttributeFilter {
  /** Nested `record.data` path, e.g. `['dimensions', 'height']`. Joined with `__`. */
  path: string[];
  operator: DataFilterOperator;
  value: string | number | string[];
}

export type ObjectsOrderingDirection = 'asc' | 'desc';

export interface ObjectsOrderingField {
  /** Nested field path, e.g. `['record', 'registrationAt']`. Joined with `__`. */
  path: string[];
  direction?: ObjectsOrderingDirection;
}

export type ObjectsOrdering = ObjectsOrderingField | ObjectsOrderingField[];

export interface ObjectsQuery {
  type?: string;
  typeVersion?: number;
  dataFilters?: DataAttributeFilter[];
  dataSearch?: string;
  ordering?: ObjectsOrdering;
  page?: number;
  pageSize?: number;
  date?: string;
  registrationDate?: string;
}

const MAX_PAGE_SIZE = 500;

/**
 * `data_attrs` is deprecated on the Objects API and intentionally not
 * supported. `fields` is left out too: projection changes the response
 * shape per call, which the client's typed response contract does not
 * model.
 */
export function serializeObjectsQuery(query: ObjectsQuery): URLSearchParams {
  const params = new URLSearchParams();

  if (query.type) {
    params.set('type', query.type);
  }
  if (query.typeVersion !== undefined) {
    params.set('typeVersion', String(query.typeVersion));
  }
  if (query.dataSearch) {
    params.set('data_icontains', query.dataSearch);
  }
  if (query.date !== undefined) {
    params.set('date', requireIsoDate(query.date, 'date'));
  }
  if (query.registrationDate !== undefined) {
    params.set('registrationDate', requireIsoDate(query.registrationDate, 'registrationDate'));
  }
  if (query.page !== undefined) {
    if (!Number.isInteger(query.page) || query.page < 1) {
      throw new Error('Objects query page must be a positive integer');
    }
    params.set('page', String(query.page));
  }
  if (query.pageSize !== undefined) {
    if (!Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > MAX_PAGE_SIZE) {
      throw new Error(`Objects query pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`);
    }
    params.set('pageSize', String(query.pageSize));
  }
  if (query.ordering) {
    params.set('ordering', serializeOrdering(query.ordering));
  }
  for (const filter of query.dataFilters ?? []) {
    params.append('data_attr', serializeDataAttributeFilter(filter));
  }

  return params;
}

export function serializeOrdering(ordering: ObjectsOrdering): string {
  const fields = Array.isArray(ordering) ? ordering : [ordering];
  if (fields.length === 0) {
    throw new Error('Objects query ordering must contain at least one field');
  }
  return fields.map(serializeOrderingField).join(',');
}

function serializeOrderingField(field: ObjectsOrderingField): string {
  requireNonEmptyPath(field.path, 'ordering');
  const key = field.path.join('__');
  return field.direction === 'desc' ? `-${key}` : key;
}

/**
 * Unlike the deprecated `data_attrs`, `data_attr` values may contain
 * commas. A double underscore in the value would still be ambiguous with
 * the `key__operator__value` delimiter, so that stays rejected.
 */
function serializeDataAttributeFilter(filter: DataAttributeFilter): string {
  requireNonEmptyPath(filter.path, 'data filter');
  if (filter.path.some((segment) => segment.includes(','))) {
    throw new Error('Objects query data filter path must not contain a comma');
  }

  const key = filter.path.join('__');
  const value = Array.isArray(filter.value) ? filter.value.map(String).join('|') : String(filter.value);

  if (value.includes('__')) {
    throw new Error('Objects query data filter value must not contain a double underscore');
  }

  return `${key}__${filter.operator}__${value}`;
}

function requireNonEmptyPath(path: string[], context: string): void {
  if (!path || path.length === 0 || path.some((segment) => segment.length === 0)) {
    throw new Error(`Objects query ${context} path must not be empty`);
  }
}

function requireIsoDate(value: string, field: string): string {
  if (!isValidIsoDate(value)) {
    throw new Error(`Objects query ${field} must be an ISO date (YYYY-MM-DD)`);
  }
  return value;
}
