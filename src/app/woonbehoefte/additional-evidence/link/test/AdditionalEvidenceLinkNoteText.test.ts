import { buildAdditionalEvidenceLinkNoteText } from '../AdditionalEvidenceLinkNoteText';

describe('buildAdditionalEvidenceLinkNoteText', () => {
  it('combines both free-text fields under their own heading', () => {
    const text = buildAdditionalEvidenceLinkNoteText('OF-EXTRA01', 'Aanvullende planning en overeenkomst.', 'Graag snel beoordelen.');

    expect(text).toBe(
      'Automatisch toegevoegd vanuit extra-bewijzeninzending OF-EXTRA01.\n'
      + '\n'
      + 'Welke extra bewijzen heeft de inwoner toegevoegd?\n'
      + 'Aanvullende planning en overeenkomst.\n'
      + '\n'
      + 'Overige opmerkingen\n'
      + 'Graag snel beoordelen.',
    );
  });

  it('omits the opmerkingen section entirely when remarks is empty, no stray heading', () => {
    const text = buildAdditionalEvidenceLinkNoteText('OF-EXTRA01', 'Aanvullende planning.', undefined);

    expect(text).not.toContain('Overige opmerkingen');
    expect(text).toBe(
      'Automatisch toegevoegd vanuit extra-bewijzeninzending OF-EXTRA01.\n\nWelke extra bewijzen heeft de inwoner toegevoegd?\nAanvullende planning.',
    );
  });

  it('omits the evidence-description section entirely when it is empty', () => {
    const text = buildAdditionalEvidenceLinkNoteText('OF-EXTRA01', undefined, 'Graag snel beoordelen.');

    expect(text).not.toContain('Welke extra bewijzen heeft de inwoner toegevoegd?');
    expect(text).toBe('Automatisch toegevoegd vanuit extra-bewijzeninzending OF-EXTRA01.\n\nOverige opmerkingen\nGraag snel beoordelen.');
  });

  it('is just the herkomstzin when both free-text fields are empty', () => {
    const text = buildAdditionalEvidenceLinkNoteText('OF-EXTRA01', undefined, undefined);

    expect(text).toBe('Automatisch toegevoegd vanuit extra-bewijzeninzending OF-EXTRA01.');
  });
});
