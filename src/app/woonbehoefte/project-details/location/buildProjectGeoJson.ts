import { ProjectPolygon } from './ProjectLocation';

export interface ProjectGeoJson {
  readonly type: 'FeatureCollection';
  readonly features: readonly [{
    readonly type: 'Feature';
    readonly properties: Record<string, never>;
    readonly geometry: ProjectPolygon;
  }];
}

/**
 * Bouwt de downloadbare FeatureCollection pas op het moment van downloaden, nooit vooraf opgeslagen. Werkt
 * uitsluitend op een polygon die checkProjectPolygon al heeft goedgekeurd; coördinaten blijven exact zoals
 * opgeslagen, geen ringrichtingconversie. Geen dossiergegevens in de properties: het OF-kenmerk staat al in
 * de bestandsnaam, en een importvoorwaarde voor extra properties bestaat niet.
 */
export function buildProjectGeoJson(polygon: ProjectPolygon): ProjectGeoJson {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: polygon,
    }],
  };
}
