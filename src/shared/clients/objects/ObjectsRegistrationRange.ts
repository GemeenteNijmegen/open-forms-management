import { ObjectsOrdering, ObjectsOrderingField } from './ObjectsQuery';
import { isValidIsoDate } from '../utils/format';

export interface ObjectsRegistrationRange {
  /** `YYYY-MM-DD`, inclusive. */
  from?: string;
  /** `YYYY-MM-DD`, inclusive. */
  to?: string;
}

const RANGE_PRIMARY_ORDERING: ObjectsOrderingField = { path: ['record', 'registrationAt'], direction: 'desc' };

export function requireValidRange(range: ObjectsRegistrationRange): void {
  if (range.from !== undefined && !isValidIsoDate(range.from)) {
    throw new Error('registrationRange.from must be an ISO date (YYYY-MM-DD)');
  }
  if (range.to !== undefined && !isValidIsoDate(range.to)) {
    throw new Error('registrationRange.to must be an ISO date (YYYY-MM-DD)');
  }
  if (range.from !== undefined && range.to !== undefined && range.from > range.to) {
    throw new Error('registrationRange.from must not be after registrationRange.to');
  }
}

/**
 * A registrationRange relies on descending record.registrationAt ordering
 * for its early stop. Caller ordering that does not start with that field
 * is rejected instead of silently changing the range semantics.
 */
export function resolveRangeOrdering(ordering: ObjectsOrdering | undefined): ObjectsOrderingField[] {
  if (!ordering) {
    return [RANGE_PRIMARY_ORDERING];
  }

  const fields = Array.isArray(ordering) ? ordering : [ordering];
  const first = fields[0];
  const isPrimaryValid = first
    && first.path.length === RANGE_PRIMARY_ORDERING.path.length
    && first.path.every((segment, index) => segment === RANGE_PRIMARY_ORDERING.path[index])
    && (first.direction ?? 'asc') === 'desc';

  if (!isPrimaryValid) {
    throw new Error('registrationRange requires ordering to start with a descending record.registrationAt field');
  }

  return fields;
}
