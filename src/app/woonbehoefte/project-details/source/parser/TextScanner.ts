/**
 * A recursive-descent parser (see RepeatingGroupValueParser.ts) needs to walk through the input text one
 * character at a time, look ahead without committing, and backtrack-free match known keywords like "None".
 * TextScanner is exactly that: a read position over a string, plus the handful of primitive read
 * operations every parse step needs. It has no notion of the repeating-group syntax itself; that logic
 * lives in RepeatingGroupValueParser.ts, which is the only caller.
 */
export class TextScannerError extends Error { }

export class TextScanner {
  private position = 0;
  constructor(private readonly text: string) { }

  /** Skips spaces, tabs and newlines. */
  skipWhitespace(): void {
    while (this.position < this.text.length && /\s/.test(this.text[this.position])) {
      this.position += 1;
    }
  }

  peek(): string | undefined {
    return this.text[this.position];
  }

  /** Reads one character and moves the read position past it. Throws if the text is already exhausted. */
  next(): string {
    const char = this.text[this.position];
    if (char === undefined) {
      throw new TextScannerError('Unexpected end of input');
    }
    this.position += 1;
    return char;
  }

  /** Throws unless the next character is exactly `char`. */
  expect(char: string): void {
    if (this.next() !== char) {
      throw new TextScannerError(`Expected '${char}' at position ${this.position}`);
    }
  }

  /** Does not consume, unlike `consume`. */
  startsWith(literal: string): boolean {
    return this.text.startsWith(literal, this.position);
  }

  /** Throws instead of moving the read position when the text does not start with `literal`. */
  consume(literal: string): void {
    if (!this.startsWith(literal)) {
      throw new TextScannerError(`Expected '${literal}' at position ${this.position}`);
    }
    this.position += literal.length;
  }

  atEnd(): boolean {
    return this.position >= this.text.length;
  }
}
