import { isValidIsoDate } from '../../../../shared/clients/utils/format';
import { SportDistrict } from '../../sportdata/SportDistrictAuthorization';
import { canonicalDistricts } from '../store/SportReport';

/**
 * Unlike `resolveSportFilter` (the `/sport` list, which silently narrows to what's allowed), a report
 * request rejects entirely if it names even one district outside `allowed`: returns `undefined` for
 * an empty selection or any unauthorized district, otherwise the canonical, deterministically sorted set.
 */
export function resolveReportDistricts(requested: string[], allowed: SportDistrict[]): SportDistrict[] | undefined {
  if (requested.length === 0) {
    return undefined;
  }
  const allowedSet = new Set<string>(allowed);
  if (requested.some((district) => !allowedSet.has(district))) {
    return undefined;
  }
  return canonicalDistricts(requested as SportDistrict[]);
}

/** `from`/`to` must both be `YYYY-MM-DD` with `from <= to`; no maximum range. */
export function resolveReportDateRange(from: string, to: string): { from: string; to: string } | undefined {
  if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) {
    return undefined;
  }
  return { from, to };
}
