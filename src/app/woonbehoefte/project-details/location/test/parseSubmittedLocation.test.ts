import { parseSubmittedLocation } from '../parseSubmittedLocation';

// Echte (geanonimiseerde) bronwaarde uit woonbehoefte-submission-minimal.csv.
const REAL_SOURCE_CELL = "{'type': 'Polygon', 'coordinates': [[[5.811185, 51.851814], [5.846297, 51.851682], "
  + '[5.846124, 51.83477], [5.811026, 51.834902], [5.811185, 51.851814]]]}';

describe('parseSubmittedLocation', () => {
  it('leest de Python-achtige dict-notatie van een echte bronwaarde als geldige polygon, zonder eval', () => {
    const result = parseSubmittedLocation(REAL_SOURCE_CELL);
    expect(result.valid).toBe(true);
    expect(result.valid && result.polygon.coordinates[0]).toHaveLength(5);
  });

  it('geeft MISSING voor een lege cel', () => {
    expect(parseSubmittedLocation('')).toEqual({ valid: false, issue: 'MISSING' });
    expect(parseSubmittedLocation('   ')).toEqual({ valid: false, issue: 'MISSING' });
  });

  it('geeft MISSING voor een ontbrekende kolom', () => {
    expect(parseSubmittedLocation(undefined)).toEqual({ valid: false, issue: 'MISSING' });
  });

  it('geeft UNREADABLE voor tekst die geen geldige Python-literal is', () => {
    expect(parseSubmittedLocation("{'type': 'Polygon', 'coordinates': }")).toEqual({ valid: false, issue: 'UNREADABLE' });
  });

  it('geeft SELF_INTERSECTING door aan checkProjectPolygon voor een bow-tie bronwaarde', () => {
    const bowtie = "{'type': 'Polygon', 'coordinates': [[[5.85, 51.85], [5.86, 51.86], [5.86, 51.85], [5.85, 51.86], [5.85, 51.85]]]}";
    expect(parseSubmittedLocation(bowtie)).toEqual({ valid: false, issue: 'SELF_INTERSECTING' });
  });
});
