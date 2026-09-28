import { TextScannerError, TextScanner } from './TextScanner';

/**
 * Open Forms levert een herhalende groep (woningenEnAansluitingen, collectieveVoorzieningenAansluitingen
 * en kovaAansluitingen zijn alle drie zo'n groep) niet als JSON aan, maar als een lijst objecten in een
 * eigen notatie: waarden staan tussen enkele aanhalingstekens (of dubbele, als de tekst zelf een enkel
 * aanhalingsteken bevat), en None, True en False worden gebruikt in plaats van null, true en false.
 * JSON.parse loopt hier gewoon op stuk, dus dit bestand is een eigen kleine parser voor precies deze notatie.
 */
export type RepeatingGroupValue = string | number | boolean | null | RepeatingGroupValue[] | { [key: string]: RepeatingGroupValue };

/** Eén regel binnen een herhalende groep, nog met de ruwe bronveldnamen zoals het formulier ze aanlevert. */
export type RawSourceRow = Record<string, RepeatingGroupValue>;

/**
 * Parst één losse waarde in deze notatie: een tekst, getal, `None`/`True`/`False`, of een geneste lijst/
 * object daarvan. Gooit een TextScannerError bij ongeldige invoer; de aanroeper bepaalt hoe een
 * parsefout per rij wordt afgehandeld.
 */
export function parseRepeatingGroupValue(text: string): RepeatingGroupValue {
  const scanner = new TextScanner(text);
  const value = parseValue(scanner);
  scanner.skipWhitespace();
  if (!scanner.atEnd()) {
    throw new TextScannerError('Unexpected trailing content after value');
  }
  return value;
}

/**
 * Parst een hele kolomwaarde: de drie herhalende groepen zijn altijd een lijst objecten. Een lege kolom
 * levert een lege lijst op; alles wat geen lijst objecten is, is een datavorm die deze feature niet kent.
 */
export function parseRepeatingGroupRows(text: string): RawSourceRow[] {
  const trimmed = text.trim();
  if (trimmed === '') {
    return [];
  }
  const parsed = parseRepeatingGroupValue(trimmed);
  if (!Array.isArray(parsed)) {
    throw new TextScannerError('Expected a list at the top level');
  }
  return parsed.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new TextScannerError('Expected every list entry to be a dict');
    }
    return entry as RawSourceRow;
  });
}

// Hieronder de implementatie: vijf functies die elkaar recursief aanroepen (een waarde kan een lijst of
// object bevatten, die op hun beurt weer waarden bevatten), samen een klassieke recursive-descent parser.
// Ze werken allemaal op dezelfde TextScanner, die bijhoudt tot waar de tekst al gelezen is.

/** Een tekst tussen aanhalingstekens. `quote` is het teken waarmee de tekst begon (' of "), zodat het juiste sluitteken herkend wordt. */
function parseQuotedString(scanner: TextScanner): string {
  const quote = scanner.next();
  let result = '';
  while (true) {
    const char = scanner.next();
    if (char === quote) {
      return result;
    }
    if (char === '\\') {
      const escaped = scanner.next();
      result += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
    } else {
      result += char;
    }
  }
}

/** Een geheel getal of decimaal getal, inclusief een eventueel exponent-deel zoals bij 1.5e3. */
function parseNumber(scanner: TextScanner): number {
  let raw = '';
  while (scanner.peek() !== undefined && /[0-9eE+\-.]/.test(scanner.peek() as string)) {
    raw += scanner.next();
  }
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new TextScannerError(`Invalid number literal '${raw}'`);
  }
  return value;
}

/** Kijkt welk type waarde er volgt (tekst, lijst, object, None/True/False of getal) en delegeert naar de bijbehorende parsefunctie. */
function parseValue(scanner: TextScanner): RepeatingGroupValue {
  scanner.skipWhitespace();
  const char = scanner.peek();
  if (char === '\'' || char === '"') {
    return parseQuotedString(scanner);
  }
  if (char === '[') {
    return parseList(scanner);
  }
  if (char === '{') {
    return parseDict(scanner);
  }
  if (scanner.startsWith('None')) {
    scanner.consume('None');
    return null;
  }
  if (scanner.startsWith('True')) {
    scanner.consume('True');
    return true;
  }
  if (scanner.startsWith('False')) {
    scanner.consume('False');
    return false;
  }
  if (char !== undefined && /[0-9+\-]/.test(char)) {
    return parseNumber(scanner);
  }
  throw new TextScannerError(`Unexpected character '${char}' at value position`);
}

/** `[...]`: nul of meer waarden gescheiden door komma's. Elke waarde wordt via parseValue gelezen, ook als dat zelf weer een lijst of object is. */
function parseList(scanner: TextScanner): RepeatingGroupValue[] {
  scanner.expect('[');
  const items: RepeatingGroupValue[] = [];
  scanner.skipWhitespace();
  if (scanner.peek() === ']') {
    scanner.next();
    return items;
  }
  while (true) {
    items.push(parseValue(scanner));
    scanner.skipWhitespace();
    const separator = scanner.next();
    if (separator === ']') {
      return items;
    }
    if (separator !== ',') {
      throw new TextScannerError(`Expected ',' or ']' in list, got '${separator}'`);
    }
    scanner.skipWhitespace();
    if (scanner.peek() === ']') {
      scanner.next();
      return items;
    }
  }
}

/** `{...}`: nul of meer `'sleutel': waarde`-paren gescheiden door komma's. Sleutels zijn altijd een aangehaalde tekst. */
function parseDict(scanner: TextScanner): { [key: string]: RepeatingGroupValue } {
  scanner.expect('{');
  const result: { [key: string]: RepeatingGroupValue } = {};
  scanner.skipWhitespace();
  if (scanner.peek() === '}') {
    scanner.next();
    return result;
  }
  while (true) {
    scanner.skipWhitespace();
    const key = parseQuotedString(scanner);
    scanner.skipWhitespace();
    scanner.expect(':');
    const value = parseValue(scanner);
    result[key] = value;
    scanner.skipWhitespace();
    const separator = scanner.next();
    if (separator === '}') {
      return result;
    }
    if (separator !== ',') {
      throw new TextScannerError(`Expected ',' or '}' in dict, got '${separator}'`);
    }
    scanner.skipWhitespace();
    if (scanner.peek() === '}') {
      scanner.next();
      return result;
    }
  }
}
