import { composeFullProjectName, FacilityLine, HousingLine, KovaLine, ProjectDetailsWorkVersion } from '../../project-details/domain/ProjectDetails';
import { buildProjectGeoJson } from '../../project-details/location/buildProjectGeoJson';
import { HOUSING_LINE_TYPE_LABELS } from '../../project-details/ui/ProjectDetailsViewModel';

export interface WoonbehoefteReportProjectDetailsColumns {
  additionalInformation: string;
  mijnAansluitingKenmerk: string;
  projectName: string;
  projectDescription: string;
  housingLinesText: string;
  facilityLinesText: string;
  kovaLinesText: string;
  projectWideNotes: string;
  locationOriginLabel: string;
  locationGeoJson: string;
}

const EMPTY_COLUMNS: WoonbehoefteReportProjectDetailsColumns = {
  additionalInformation: '',
  mijnAansluitingKenmerk: '',
  projectName: '',
  projectDescription: '',
  housingLinesText: '',
  facilityLinesText: '',
  kovaLinesText: '',
  projectWideNotes: '',
  locationOriginLabel: '',
  locationGeoJson: '',
};

function housingLineLines(line: HousingLine): string[] {
  const lines = [
    `Type: ${HOUSING_LINE_TYPE_LABELS[line.type]}`,
    `Aantal aansluitingen: ${line.connectionCount}`,
    `Type aansluiting: ${line.connectionType}`,
  ];
  if (line.homesAccordingToForm !== undefined) {
    lines.push(`Aantal woningen volgens formulier: ${line.homesAccordingToForm}`);
  }
  lines.push('Overige gegevens:', line.otherDetails);
  return lines;
}

function facilityLineLines(line: FacilityLine): string[] {
  return [
    `Type: ${line.facilityType}`,
    `Aantal aansluitingen: ${line.connectionCount}`,
    `Type aansluiting: ${line.connectionType}`,
    'Overige gegevens:',
    line.otherDetails,
  ];
}

function kovaLineLines(line: KovaLine): string[] {
  return [
    `Functie: ${line.function}`,
    `Aantal aansluitingen: ${line.connectionCount}`,
    `Type aansluiting: ${line.connectionType}`,
    'Overige gegevens:',
    line.otherDetails,
  ];
}

/** Zelfde sortering als de detailpagina (order), met lineId als vaste tweede sleutel voor een voorspelbare exportvolgorde bij een gelijke order. */
function formatLinesText<T extends { order: number; lineId: string }>(lines: Record<string, T>, toLines: (line: T) => string[]): string {
  const sorted = Object.values(lines).sort((a, b) => a.order - b.order || a.lineId.localeCompare(b.lineId));
  return sorted.map((line, index) => {
    const [firstLine, ...restLines] = toLines(line);
    return [`${index + 1}. ${firstLine}`, ...restLines].join('\n');
  }).join('\n\n');
}

function locationOriginLabel(workVersion: ProjectDetailsWorkVersion): string {
  if (workVersion.manualLocationPolygon) {
    return 'Handmatig aangepast';
  }
  if (workVersion.sourceLocationPolygon) {
    return 'Uit formulier';
  }
  return 'Geen bruikbare locatie';
}

function locationGeoJsonText(workVersion: ProjectDetailsWorkVersion): string {
  const polygon = workVersion.manualLocationPolygon ?? workVersion.sourceLocationPolygon;
  return polygon ? JSON.stringify(buildProjectGeoJson(polygon), null, 2) : '';
}

/**
 * Bij een dossier zonder werkversie blijven alle tien kolommen leeg, ook de samengestelde projectnaam en
 * herkomst: dat onderscheidt een dossier zonder werkversie van een werkversie die zelf toevallig nergens een
 * locatie heeft (die krijgt wel het label "Geen bruikbare locatie").
 */
export function buildWoonbehoefteReportProjectDetailsColumns(
  workVersion: ProjectDetailsWorkVersion | undefined,
): WoonbehoefteReportProjectDetailsColumns {
  if (!workVersion) {
    return EMPTY_COLUMNS;
  }
  return {
    additionalInformation: workVersion.additionalInformation,
    mijnAansluitingKenmerk: workVersion.mijnAansluitingKenmerk ?? '',
    projectName: composeFullProjectName(workVersion.caseReference, workVersion.readableProjectName),
    projectDescription: workVersion.projectDescription,
    housingLinesText: formatLinesText(workVersion.housingLines, housingLineLines),
    facilityLinesText: formatLinesText(workVersion.collectiveFacilityLines, facilityLineLines),
    kovaLinesText: formatLinesText(workVersion.kovaLines, kovaLineLines),
    projectWideNotes: workVersion.projectWideNotes,
    locationOriginLabel: locationOriginLabel(workVersion),
    locationGeoJson: locationGeoJsonText(workVersion),
  };
}
