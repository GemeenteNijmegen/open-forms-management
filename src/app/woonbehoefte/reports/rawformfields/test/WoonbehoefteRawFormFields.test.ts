import {
  collectRawFormFieldHeaders, isExcludedRawFormField, parseWoonbehoefteRawFormRow, serializeRawFormFieldValue,
} from '../WoonbehoefteRawFormFields';

function csv(headers: string[], values: string[]): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return `${headers.join(',')}\n${values.map(escape).join(',')}\n`;
}

describe('parseWoonbehoefteRawFormRow', () => {
  it('keeps simple content fields as-is', () => {
    const row = parseWoonbehoefteRawFormRow(csv(['projectNaam', 'totaalAantalWoningen'], ['Project Rivierzicht', '42']));

    expect(row.values.projectNaam).toBe('Project Rivierzicht');
    expect(row.values.totaalAantalWoningen).toBe('42');
    expect(row.headers).toEqual(['projectNaam', 'totaalAantalWoningen']);
  });

  it('keeps a nested/repeating JSON value as one raw string, never interpreted', () => {
    const nested = '[{"type":"woonhuis","aantal":12},{"type":"appartement","aantal":30}]';
    const row = parseWoonbehoefteRawFormRow(csv(['woningenEnAansluitingen'], [nested]));

    expect(row.values.woningenEnAansluitingen).toBe(nested);
  });

  it('excludes internalNotificationEmails, networkShare and upload-component fields', () => {
    const row = parseWoonbehoefteRawFormRow(csv(
      ['projectNaam', 'internalNotificationEmails', 'networkShare', 'uploadBewijsstukken'],
      ['Project Een', '["intern@example.test"]', '//example.invalid/share', '[{"url":"https://x","name":"bewijs.pdf"}]'],
    ));

    expect(row.headers).toEqual(['projectNaam']);
    expect(row.values).toEqual({ projectNaam: 'Project Een' });
  });

  it('does not exclude a content field only because it starts with a similar-looking prefix mid-word', () => {
    // "upload" only excludes when it is the actual start of the header, not an unrelated field.
    expect(isExcludedRawFormField('projectSpecifiekeToelichting')).toBe(false);
    expect(isExcludedRawFormField('uploadBewijsstukken')).toBe(true);
  });

  it('rejects a CSV with more or fewer than exactly one submission row', () => {
    expect(() => parseWoonbehoefteRawFormRow('projectNaam\n')).toThrow();
    expect(() => parseWoonbehoefteRawFormRow('projectNaam\nA\nB\n')).toThrow();
  });
});

describe('collectRawFormFieldHeaders', () => {
  it('keeps first-seen order across rows with different headers, deduplicated', () => {
    const rowA = parseWoonbehoefteRawFormRow(csv(['projectNaam', 'eanCodeOfAanmeldnummer'], ['Project Een', 'AANMELD-1']));
    const rowB = parseWoonbehoefteRawFormRow(csv(['eanCodeOfAanmeldnummer', 'nieuwVeldLatereFormulierversie'], ['AANMELD-2', 'Nieuwe inhoud']));

    expect(collectRawFormFieldHeaders([rowA, rowB])).toEqual(['projectNaam', 'eanCodeOfAanmeldnummer', 'nieuwVeldLatereFormulierversie']);
  });
});

describe('serializeRawFormFieldValue', () => {
  it('returns the value close to verbatim in this first version', () => {
    expect(serializeRawFormFieldValue('=DIT-MAG-GEEN-FORMULE-WORDEN')).toBe('=DIT-MAG-GEEN-FORMULE-WORDEN');
  });
});
