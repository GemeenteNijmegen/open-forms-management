import { PermissionEvaluator } from '../../../shared/authorization/PermissionEvaluator';

export const SPORT_DISTRICTS = [
  'nijmegenCentrum',
  'nijmegenOost',
  'nijmegenMiddenZuid',
  'nijmegenOudNieuwWest',
  'dukenburg',
  'lindenholt',
  'nijmegenNoord',
] as const;

export type SportDistrict = typeof SPORT_DISTRICTS[number];

/** Labels as Open Forms itself serializes them in the CSV's `stadsdeelData` column. */
export const SPORT_DISTRICT_LABELS: Record<SportDistrict, string> = {
  nijmegenCentrum: 'Nijmegen-Centrum',
  nijmegenOost: 'Nijmegen-Oost',
  nijmegenMiddenZuid: 'Nijmegen-Midden & Zuid',
  nijmegenOudNieuwWest: 'Nijmegen-Oud & Nieuw-West',
  dukenburg: 'Dukenburg',
  lindenholt: 'Lindenholt',
  nijmegenNoord: 'Nijmegen-Noord',
};

/**
 * Sport has no district list of its own: every known district is checked against the existing
 * evaluator (global admin, Sport resource admin, or a scoped `districts` grant), instead of building
 * a second permission model just for Sport.
 */
export function resolveAllowedDistricts(evaluator: PermissionEvaluator): SportDistrict[] {
  return SPORT_DISTRICTS.filter(
    (district) => evaluator.evaluate({ resource: 'sport', action: 'view', scope: { districts: district } }) === 'ALLOW',
  );
}
