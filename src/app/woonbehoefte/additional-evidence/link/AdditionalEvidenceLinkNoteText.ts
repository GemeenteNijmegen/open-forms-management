/**
 * Composes the automatic `ADDITIONAL_INFORMATION` note text added on a successful koppeling. Omits a
 * section entirely when its free-text field is empty, rather than leaving behind an empty heading.
 */
export function buildAdditionalEvidenceLinkNoteText(
  submissionReference: string, evidenceDescription: string | undefined, remarks: string | undefined,
): string {
  const lines = [`Automatisch toegevoegd vanuit extra-bewijzeninzending ${submissionReference}.`];
  if (evidenceDescription) {
    lines.push('', 'Welke extra bewijzen heeft de inwoner toegevoegd?', evidenceDescription);
  }
  if (remarks) {
    lines.push('', 'Overige opmerkingen', remarks);
  }
  return lines.join('\n');
}
