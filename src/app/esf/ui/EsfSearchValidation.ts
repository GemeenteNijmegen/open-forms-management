import { ESF_SEARCH_TYPES, EsfSearchRequest, EsfSearchType } from '../data/EsfSearchService';

export interface EsfFormValues {
  periodenummer: string;
  zoeksoort: string;
  zoekwaarde: string;
}

export type EsfSearchValidation =
  | { valid: true; request: EsfSearchRequest; values: EsfFormValues }
  | { valid: false; errors: string[]; values: EsfFormValues };

const PERIODENUMMER_PATTERN = /^\d{4}(0[1-9]|1[0-2])$/;
const NUMMER_MAX_LENGTH = 30;

export function validateEsfSearch(form: URLSearchParams): EsfSearchValidation {
  const values: EsfFormValues = {
    periodenummer: (form.get('periodenummer') ?? '').trim(),
    zoeksoort: form.get('zoeksoort') ?? '',
    zoekwaarde: (form.get('zoekwaarde') ?? '').trim(),
  };

  const errors: string[] = [];
  if (!PERIODENUMMER_PATTERN.test(values.periodenummer)) {
    errors.push('Vul de periode in als JJJJMM, bijvoorbeeld 202610.');
  }
  if (!isSearchType(values.zoeksoort)) {
    errors.push('Kies clientnummer of dossiernummer.');
  }
  if (!isValidNummer(values.zoekwaarde)) {
    errors.push('Vul een nummer in van maximaal 30 tekens, zonder dubbele underscore.');
  }

  if (errors.length > 0 || !isSearchType(values.zoeksoort)) {
    return { valid: false, errors, values };
  }
  return {
    valid: true,
    values,
    request: { periodenummer: values.periodenummer, searchType: values.zoeksoort, searchValue: values.zoekwaarde },
  };
}

// The Objects API filter uses a double underscore as separator, so a value cannot contain one.
function isValidNummer(value: string): boolean {
  return value.length > 0 && value.length <= NUMMER_MAX_LENGTH && !value.includes('__');
}

function isSearchType(value: string): value is EsfSearchType {
  return (ESF_SEARCH_TYPES as readonly string[]).includes(value);
}
