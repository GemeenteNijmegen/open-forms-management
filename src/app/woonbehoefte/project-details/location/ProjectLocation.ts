/**
 * Precies het GeoJSON-subset dat deze feature ondersteunt: één buitenring, geen gaten, WGS 84 [lon, lat].
 */
export interface ProjectPolygon {
  readonly type: 'Polygon';
  readonly coordinates: readonly (readonly [number, number])[][];
}

export type ProjectLocationIssueCode =
  | 'MISSING'
  | 'UNREADABLE'
  | 'INVALID_SHAPE'
  | 'HOLE'
  | 'ZERO_AREA'
  | 'SELF_INTERSECTING'
  | 'IMPLAUSIBLE_COORDINATES';

export type ProjectLocationOutcome =
  | { readonly valid: true; readonly polygon: ProjectPolygon }
  | { readonly valid: false; readonly issue: ProjectLocationIssueCode };
