import { buildFacilityLines } from './parser/parseFacilityColumn';
import { buildHousingLines } from './parser/parseHousingColumn';
import { buildKovaLines } from './parser/parseKovaColumn';
import { ProjectDetailsCsvData, ProjectDetailsProjectWideFields } from './ProjectDetailsCsvParser';
import { NewWorkVersionInput } from '../persistence/ProjectDetailsStore';

const PROJECT_WIDE_LABELS: Record<keyof ProjectDetailsProjectWideFields, string> = {
  solarPanelsBehindMeter: 'Zonnepanelen achter de meter',
  solarPanelCount: 'Aantal zonnepanelen',
  solarPanelWattPeak: 'Wattpiek per zonnepaneel',
  chargingPointsBehindMeter: 'Laadpalen achter de meter',
  chargingPointCount: 'Aantal laadpalen',
  chargingPointsMaxPowerKw: 'Piekvermogen laadpalen (kW)',
};

const PROJECT_WIDE_HEADING = 'Deze gegevens gelden voor het hele project.';

function buildProjectWideNotes(fields: ProjectDetailsProjectWideFields): string {
  const lines = (Object.keys(PROJECT_WIDE_LABELS) as (keyof ProjectDetailsProjectWideFields)[])
    .filter((key) => fields[key] !== undefined)
    .map((key) => `${PROJECT_WIDE_LABELS[key]}: ${fields[key]}`);
  return [PROJECT_WIDE_HEADING, ...lines].join('\n');
}

/**
 * Bouwt de volledige initiële werkversie-inhoud uit de geparste CSV. Het parsen van elke kolom staat in
 * zijn eigen bestand onder parser/; hier worden de resultaten alleen samengevoegd. Slaat verder niets op.
 */
export function buildProjectDetailsPrefill(csvData: ProjectDetailsCsvData): NewWorkVersionInput {
  return {
    readableProjectName: csvData.projectName ?? '',
    projectDescription: csvData.projectDescription ?? '',
    additionalInformation: '',
    projectWideNotes: buildProjectWideNotes(csvData.projectWideFields),
    housingLines: buildHousingLines(csvData.housingRows, csvData.isCollectiveHousing),
    collectiveFacilityLines: buildFacilityLines(csvData.facilityRows),
    kovaLines: buildKovaLines(csvData.kovaRows),
  };
}
