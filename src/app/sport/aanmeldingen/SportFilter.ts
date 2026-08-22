import { SportDistrict } from '../sportdata/SportDistrictAuthorization';
import { SportAanmeldType } from '../sportdata/SportSubmission';

const SPORT_AANMELD_TYPES: SportAanmeldType[] = ['kind', 'volwassene'];

export interface SportFilter {
  districts: SportDistrict[];
  types: SportAanmeldType[];
}

// Een uitgevinkte checkbox stuurt de browser niet mee, dus een lege district/type-lijst is op zich
// dubbelzinnig: vers geopende pagina, of bewust alles uitgevinkt en op Filteren gedrukt? filterSubmitted
// staat er zodra het formulier verstuurd is, los van wat is aangevinkt, en maakt dat onderscheid.
// Geen filterSubmitted: fallback naar alle toegestane wijken en beide types. Wel filterSubmitted: de
// querystring letterlijk overnemen, ook als dat een lege selectie is.
//
// Wat binnenkomt wordt sowieso doorsneden met allowedDistricts: het filter kan alleen versmallen wat
// iemand al mag zien, nooit verbreden.
export function resolveSportFilter(
  queryStringParameters: Record<string, string | undefined> | undefined,
  allowedDistricts: SportDistrict[],
): SportFilter {
  if (queryStringParameters?.filterSubmitted !== '1') {
    return { districts: allowedDistricts, types: [...SPORT_AANMELD_TYPES] };
  }

  const requestedDistricts = splitValues(queryStringParameters.district);
  const requestedTypes = splitValues(queryStringParameters.type);

  return {
    districts: allowedDistricts.filter((district) => requestedDistricts.includes(district)),
    types: SPORT_AANMELD_TYPES.filter((type) => requestedTypes.includes(type)),
  };
}

function splitValues(value: string | undefined): string[] {
  return value ? value.split(',').filter((entry) => entry.length > 0) : [];
}
