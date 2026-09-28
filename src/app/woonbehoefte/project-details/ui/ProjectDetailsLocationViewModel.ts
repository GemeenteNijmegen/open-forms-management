import { formatDutchDateTime } from '../../domain/WoonbehoefteFormatting';
import { ProjectDetailsWorkVersion } from '../domain/ProjectDetails';
import { ProjectLocationIssueCode } from '../location/ProjectLocation';

/** Voor de bronstatus: de bronwaarde zelf is nooit door de medewerker getypt, dus deze teksten praten over "de bronwaarde"/"het formulier". */
const SOURCE_ISSUE_MESSAGES: Record<ProjectLocationIssueCode, string> = {
  MISSING: 'er is geen locatie ingevuld',
  UNREADABLE: 'de bronwaarde kon niet worden gelezen',
  INVALID_SHAPE: 'de bronwaarde heeft een onjuiste vorm',
  HOLE: 'de bronwaarde bevat een gat',
  ZERO_AREA: 'de bronwaarde heeft geen oppervlak',
  SELF_INTERSECTING: 'zelfkruising',
  IMPLAUSIBLE_COORDINATES: 'de coördinaten lijken niet op een locatie in of rond Nijmegen',
  MULTIPLE_FEATURES: 'de bronwaarde bevat meerdere vlakken',
  TOO_LARGE: 'de bronwaarde is te groot',
};

/** Voor een net mislukte handmatige opslag: de medewerker heeft dit zelf getypt/geplakt, dus deze teksten geven een directe, bruikbare reden. */
const MANUAL_ERROR_MESSAGES: Record<ProjectLocationIssueCode, string> = {
  MISSING: 'Plak eerst een GeoJSON-polygon in het tekstveld.',
  UNREADABLE: 'Deze tekst is geen geldige JSON.',
  INVALID_SHAPE: 'Dit is geen geldige polygon.',
  HOLE: 'Een polygon met een gat wordt niet ondersteund.',
  ZERO_AREA: 'Deze polygon heeft geen oppervlak.',
  SELF_INTERSECTING: 'Deze polygon kruist zichzelf.',
  IMPLAUSIBLE_COORDINATES: 'Deze coördinaten liggen niet in of rond Nijmegen. Controleer of lengte- en breedtegraad niet zijn verwisseld.',
  MULTIPLE_FEATURES: 'Er staan meerdere vlakken in deze GeoJSON. Plak precies één vlak.',
  TOO_LARGE: 'Deze invoer is te groot.',
};

function isProjectLocationIssueCode(value: string): value is ProjectLocationIssueCode {
  return value in MANUAL_ERROR_MESSAGES;
}

export interface ProjectDetailsLocationViewModel {
  isLocationManual: boolean;
  isLocationBronValid: boolean;
  isLocationBronMissing: boolean;
  isLocationBronUnusablePrimary: boolean;
  isLocationBronUnusableContext: boolean;
  locationBronIssueMessage?: string;
  locationManualSetAtLabel?: string;
  locationManualSetByLabel?: string;
  locationCanDownload: boolean;
  locationErrorMessage?: string;
}

/**
 * Apart van de rest van de Projectdetails-werkversie: hier zit de voorrangsregel (handmatig boven bron) en
 * de vertaling van reden-codes naar begrijpelijke tekst, zodat de template zelf geen technische parsercodes
 * hoeft te kennen. Velden staan plat op het uiteindelijke viewmodel (net als de rest van deze pagina),
 * omdat Mustache.js geen parent-context-lookup heeft.
 */
export function buildProjectDetailsLocationViewModel(
  workVersion: ProjectDetailsWorkVersion | undefined, locationErrorCode: string | undefined,
): ProjectDetailsLocationViewModel {
  const isManual = Boolean(workVersion?.manualLocationPolygon);
  const isBronValid = !isManual && Boolean(workVersion?.sourceLocationPolygon);
  const bronIssue = workVersion?.sourceLocationIssue;
  const isBronUnusable = Boolean(bronIssue) && bronIssue !== 'MISSING';
  const isBronMissing = !isManual && !isBronValid && !isBronUnusable;

  return {
    isLocationManual: isManual,
    isLocationBronValid: isBronValid,
    isLocationBronMissing: isBronMissing,
    isLocationBronUnusablePrimary: !isManual && isBronUnusable,
    isLocationBronUnusableContext: isManual && isBronUnusable,
    ...(bronIssue && isBronUnusable ? { locationBronIssueMessage: SOURCE_ISSUE_MESSAGES[bronIssue] } : {}),
    ...(workVersion?.manualLocationSetAt ? { locationManualSetAtLabel: formatDutchDateTime(workVersion.manualLocationSetAt) } : {}),
    ...(workVersion?.manualLocationSetBy ? { locationManualSetByLabel: workVersion.manualLocationSetBy } : {}),
    locationCanDownload: Boolean(workVersion?.manualLocationPolygon ?? workVersion?.sourceLocationPolygon),
    ...(locationErrorCode && isProjectLocationIssueCode(locationErrorCode)
      ? { locationErrorMessage: MANUAL_ERROR_MESSAGES[locationErrorCode] } : {}),
  };
}
