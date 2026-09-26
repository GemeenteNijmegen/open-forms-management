import { ProjectPolygon } from './ProjectLocation';

export interface ProjectGeoJson {
  readonly type: 'FeatureCollection';
  readonly features: readonly [{
    readonly type: 'Feature';
    readonly properties: { readonly ofKenmerk: string; readonly projectnaam: string };
    readonly geometry: ProjectPolygon;
  }];
}

/**
 * Bouwt de downloadbare FeatureCollection pas op het moment van downloaden, nooit vooraf opgeslagen. Werkt
 * uitsluitend op een polygon die checkProjectPolygon al heeft goedgekeurd; coördinaten blijven exact zoals
 * opgeslagen, geen ringrichtingconversie.
 */
export function buildProjectGeoJson(caseReference: string, fullProjectName: string, polygon: ProjectPolygon): ProjectGeoJson {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { ofKenmerk: caseReference, projectnaam: fullProjectName },
      geometry: polygon,
    }],
  };
}
