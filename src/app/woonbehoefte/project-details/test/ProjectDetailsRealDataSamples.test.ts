import { readFileSync } from 'fs';
import { join } from 'path';
import { buildProjectDetailsPrefill } from '../source/buildProjectDetailsPrefill';
import { parseProjectDetailsCsv } from '../source/ProjectDetailsCsvParser';

/**
 * Deze CSV's zijn afgeleid van echte (geanonimiseerde) aanvragen uit
 * `workspace/workdocs/userdata/woonbehoefte-overzicht-geen-persoonsgegevens.xlsx`: alleen de kolommen die
 * `parseProjectDetailsCsv` nodig heeft, per bestand geselecteerd op een specifiek lastig scenario.
 * `projectNaam` en de projecttoelichting zijn vervangen door generieke placeholders (de brondata bevatte
 * herkenbare Nijmeegse projectnamen/adressen); de overige velden en waarden zijn ongewijzigd. Dit dekt de
 * volledige pijplijn (CSV-parse + prefill-mapping) tegen daadwerkelijke bronrepresentatie, niet alleen
 * tegen handgebouwde fixtures.
 */
function sample(name: string): string {
  return readFileSync(join(__dirname, 'samples', name), 'utf-8');
}

describe('ProjectDetails prefill against real-data samples', () => {
  it('woonhuis: de eenvoudigste echte aanvraag, één woonregel zonder voorzieningen/KOVA', () => {
    const data = parseProjectDetailsCsv(sample('woonbehoefte-project-details-woonhuis.csv'), 'OF-1');
    const prefill = buildProjectDetailsPrefill(data);

    expect(Object.values(prefill.housingLines)).toHaveLength(1);
    expect(Object.values(prefill.housingLines)[0]).toMatchObject({ type: 'WOONHUIS', connectionCount: 1, connectionType: '3x63A' });
    expect(prefill.collectiveFacilityLines).toEqual({});
    expect(prefill.kovaLines).toEqual({});
    expect(prefill.additionalInformation).toBe('');
    // De echte afnameTeruglevering-waarde is hier de losse keuzelijst-array van het formuliercomponent, geen echte
    // per-regel waarde; die mag nooit als ruwe tekst in Overige gegevens verschijnen.
    expect(Object.values(prefill.housingLines)[0].otherDetails).not.toContain('Afname');
  });

  it('ambigu collectief: één woonhuis-regel naast twee gecombineerde appartementregels met collectief-vlag ja', () => {
    const data = parseProjectDetailsCsv(sample('woonbehoefte-project-details-ambigu-collectief.csv'), 'OF-2');
    const prefill = buildProjectDetailsPrefill(data);

    const housing = Object.values(prefill.housingLines).sort((a, b) => a.order - b.order);
    expect(housing).toHaveLength(3);
    expect(housing[0]).toMatchObject({ type: 'WOONHUIS', connectionCount: 5 });
    // De twee gecombineerde appartementregels zijn allebei ambigu-collectief, nooit stilzwijgend Collectief wonen.
    expect(housing[1]).toMatchObject({ type: 'APPARTEMENTEN_COLLECTIEF_WONEN', connectionCount: 8 });
    expect(housing[2]).toMatchObject({ type: 'APPARTEMENTEN_COLLECTIEF_WONEN', connectionCount: 2 });
    expect(Object.keys(prefill.collectiveFacilityLines)).toHaveLength(1);
    expect(Object.keys(prefill.kovaLines)).toHaveLength(1);
  });

  it('collectief wonen + grootverbruik: gecombineerde regel wordt Collectief wonen, grootverbruik resolveert de aansluiting', () => {
    const data = parseProjectDetailsCsv(sample('woonbehoefte-project-details-collectief-wonen-grootverbruik.csv'), 'OF-3');
    const prefill = buildProjectDetailsPrefill(data);

    const [line] = Object.values(prefill.housingLines);
    expect(line).toMatchObject({ type: 'COLLECTIEF_WONEN', connectionType: 'AC4a' });
    // projectAantalLaadpalen=2 in de bron; het projectbrede blok staat los van de woonregel.
    expect(prefill.projectWideNotes).toContain('Aantal laadpalen: 2');
    expect(line.otherDetails).not.toContain('laadpalen');
  });

  it('collectief wonen + bijna-identieke voorzieningen: één afwijkend veld houdt twee voorzieningen apart, ook binnen Collectief wonen', () => {
    const data = parseProjectDetailsCsv(sample('woonbehoefte-project-details-collectief-wonen-bijna-identiek.csv'), 'OF-4');
    const prefill = buildProjectDetailsPrefill(data);

    expect(Object.values(prefill.housingLines)[0].type).toBe('COLLECTIEF_WONEN');
    const facilities = Object.values(prefill.collectiveFacilityLines);
    expect(facilities).toHaveLength(2);
    expect(facilities.every((line) => line.connectionCount === 1)).toBe(true);
  });

  it('wonen aansluiting anders: aansluitingKleinverbruik=anders resolveert naar de vrije aansluitingKleinverbruikAnders-tekst', () => {
    const data = parseProjectDetailsCsv(sample('woonbehoefte-project-details-wonen-aansluiting-anders.csv'), 'OF-5');
    const prefill = buildProjectDetailsPrefill(data);

    expect(Object.values(prefill.housingLines)[0].connectionType).toBe('onbekend');
  });

  it('voorziening anders + duplicaten: twee identieke anders-voorzieningen worden één regel met aantal 2', () => {
    const data = parseProjectDetailsCsv(sample('woonbehoefte-project-details-voorziening-anders-en-duplicaten.csv'), 'OF-6');
    const prefill = buildProjectDetailsPrefill(data);

    const lines = Object.values(prefill.collectiveFacilityLines);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      facilityType: 'Lift, ventilatie, verlichting, hydrofoor, laadpalen en overige algemene voorzieningen', connectionCount: 2, connectionType: '3x80A',
    });
    expect(lines[0].otherDetails).toContain('Transportvermogen afname (kW): 55.4');
  });

  it('KOVA duplicaten: twee identieke winkelfunctie-regels (met een apostrof in de vrije tekst) worden één regel', () => {
    const data = parseProjectDetailsCsv(sample('woonbehoefte-project-details-kova-duplicaten.csv'), 'OF-7');
    const prefill = buildProjectDetailsPrefill(data);

    const lines = Object.values(prefill.kovaLines);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ function: 'winkelfunctie', connectionCount: 2, connectionType: '3x25A' });
    expect(lines[0].otherDetails).toContain("Maatschappelijke 'plint' waarop gebouwd wordt");
  });

  it('KOVA anders: kovaActiviteit=anders resolveert naar de vrije kovaActiviteitAnders-tekst', () => {
    const data = parseProjectDetailsCsv(sample('woonbehoefte-project-details-kova-anders.csv'), 'OF-8');
    const prefill = buildProjectDetailsPrefill(data);

    expect(Object.values(prefill.kovaLines)[0].function).toBe('Fietsreparatie cafe');
  });

  it('KOVA transportvermogen nul: een teruglevering van exact 0 kW blijft zichtbaar in Overige gegevens, projectbrede zonnepanelen staan los', () => {
    const data = parseProjectDetailsCsv(sample('woonbehoefte-project-details-kova-transportvermogen-nul.csv'), 'OF-9');
    const prefill = buildProjectDetailsPrefill(data);

    expect(Object.values(prefill.kovaLines)[0].otherDetails).toContain('Transportvermogen teruglevering (kW): 0');
    expect(prefill.projectWideNotes).toContain('Aantal zonnepanelen: 130');
  });

  it('maximaal gevuld dossier: 1 woonregel, 8 voorzieningenregels in 4 groepen, 18 KOVA-regels in 7 groepen', () => {
    const data = parseProjectDetailsCsv(sample('woonbehoefte-project-details-maximaal-gevuld.csv'), 'OF-10');
    const prefill = buildProjectDetailsPrefill(data);

    expect(Object.keys(prefill.housingLines)).toHaveLength(1);
    expect(Object.values(prefill.housingLines)[0].type).toBe('APPARTEMENTEN');

    const facilityCounts = Object.values(prefill.collectiveFacilityLines).map((line) => line.connectionCount).sort((a, b) => b - a);
    expect(facilityCounts).toEqual([3, 2, 2, 1]);

    const kovaCounts = Object.values(prefill.kovaLines).map((line) => line.connectionCount).sort((a, b) => b - a);
    expect(kovaCounts).toEqual([10, 2, 2, 1, 1, 1, 1]);
  });

  describe('foutpaden', () => {
    // Kolomnamen komen uit een echte sample; de rij zelf is bewust kapot/onvolledig, dus niet uit een sample te halen.
    const header = sample('woonbehoefte-project-details-woonhuis.csv').split('\n')[0];

    it('gooit op een ontbrekende verplichte kolom, in plaats van stilzwijgend leeg te blijven', () => {
      const columnsWithoutKova = header.split(',').filter((column) => column !== 'kovaAansluitingen');
      const csvWithoutKovaColumn = `${columnsWithoutKova.join(',')}\n${columnsWithoutKova.map(() => '').join(',')}\n`;

      expect(() => parseProjectDetailsCsv(csvWithoutKovaColumn, 'OF-TEST')).toThrow();
    });

    it('gooit op een kapotte Python-literal in een arraykolom, in plaats van rijen stilzwijgend te verliezen', () => {
      const values = header.split(',').map((column) => (column === 'woningenEnAansluitingen' ? "[{'aantalWoningen': }]" : ''));
      const corruptedCsv = `${header}\n${values.join(',')}\n`;

      expect(() => parseProjectDetailsCsv(corruptedCsv, 'OF-TEST')).toThrow();
    });

    it('gooit op nul of meer dan één datarij', () => {
      expect(() => parseProjectDetailsCsv(`${header}\n`, 'OF-TEST')).toThrow();
    });
  });
});
