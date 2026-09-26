import { RawSourceRow } from './RepeatingGroupValueParser';

/** Nette labels voor bronvelden die geregeld voorkomen; een veld zonder label hier krijgt zijn eigen naam met spaties, zie humanizeFieldName. */
const FIELD_LABELS: Record<string, string> = {
  verwarmingswijzeWoonhuis: 'Verwarmingswijze',
  verwarmingswijzeWoonhuisAnders: 'Verwarmingswijze (anders)',
  verwarmingswijzeAppartement: 'Verwarmingswijze',
  verwarmingswijzeAppartementAnders: 'Verwarmingswijze (anders)',
  isGrootverbruikaansluiting: 'Grootverbruikaansluiting',
  gewenstGtvAfnameKw: 'Gewenst vermogen afname (kW)',
  gewenstGtvTerugleveringKw: 'Gewenst vermogen teruglevering (kW)',
  collectieveVoorzieningAfnameTeruglevering: 'Afname/teruglevering',
  collectieveVoorzieningTransportvermogenAfnameKw: 'Transportvermogen afname (kW)',
  collectieveVoorzieningTransportvermogenTerugleveringKw: 'Transportvermogen teruglevering (kW)',
  kovaAfnameTeruglevering: 'Afname/teruglevering',
  kovaTransportvermogenAfnameKw: 'Transportvermogen afname (kW)',
  kovaTransportvermogenTerugleveringKw: 'Transportvermogen teruglevering (kW)',
  kovaVerwarmingswijze: 'Verwarmingswijze',
  kovaVerwarmingswijzeAnders: 'Verwarmingswijze (anders)',
  kovaZonnepanelenAchterMeter: 'Zonnepanelen achter de meter',
  kovaAantalZonnepanelen: 'Aantal zonnepanelen',
  kovaWattpiekPerZonnepaneel: 'Wattpiek per zonnepaneel',
  kovaLaadpalenAchterMeter: 'Laadpalen achter de meter',
  kovaAantalLaadpalen: 'Aantal laadpalen',
  kovaMaxPiekvermogenLaadpalenKw: 'Piekvermogen laadpalen (kW)',
  optioneleBeschrijvingKovaFunctie: 'Beschrijving functie',
};

function humanizeFieldName(field: string): string {
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? humanizeFieldName(field);
}

/**
 * Elk bronveld dat niet als apart, gestructureerd veld is opgenomen wordt hier een eigen gelabelde regel.
 * Een array- of objectwaarde (zoals de losse keuzelijst die in afnameTeruglevering kan achterblijven) is
 * nooit een echte waarde voor deze regel en wordt overgeslagen, nooit als ruwe tekst getoond.
 */
export function buildOtherDetails(row: RawSourceRow, excludedKeys: ReadonlySet<string>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (excludedKeys.has(key)) {
      continue;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      lines.push(`${fieldLabel(key)}: ${value}`);
    } else if (typeof value === 'number') {
      lines.push(`${fieldLabel(key)}: ${value}`);
    } else if (typeof value === 'boolean') {
      lines.push(`${fieldLabel(key)}: ${value ? 'Ja' : 'Nee'}`);
    }
  }
  return lines.join('\n');
}
