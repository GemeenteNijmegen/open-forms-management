import { AdditionalEvidenceSourceItem, isReadyAdditionalEvidenceSource } from '../../additional-evidence/domain/AdditionalEvidenceSource';
import { CaseSourceLink } from '../../domain/WoonbehoefteCase';
import { SourceDocumentReference } from '../../domain/WoonbehoefteSource';

export interface CaseAttachmentReferences {
  /** Primary attachments first, then each linked Additional Evidence source's attachments, oldest link first. Deduplicated by documentId. */
  references: SourceDocumentReference[];
  /** A linked Additional Evidence source that could not be read (missing from the cache, or FAILED), never the report as a whole. */
  missingAdditionalSourceCount: number;
}

export interface AttachmentFilenamesOutcome {
  /** One filename per line, in collectCaseAttachmentReferences order; empty when there are no attachments. */
  filenamesText: string;
  /** Set only when a filename could not be resolved, or a linked Additional Evidence source could not be read. */
  warning?: string;
}

function onlyAttachments(references: SourceDocumentReference[] | undefined): SourceDocumentReference[] {
  return (references ?? []).filter((reference) => reference.role === 'ATTACHMENT');
}

function dedupeByDocumentId(references: SourceDocumentReference[]): SourceDocumentReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    if (seen.has(reference.documentId)) {
      return false;
    }
    seen.add(reference.documentId);
    return true;
  });
}

/**
 * primaryAttachments comes straight from the case's own joined primary source. sourceLinks is every
 * SOURCE# link under the case (both relations); additionalSourcesByObjectUuid resolves each ADDITIONAL
 * link's own attachments through the shared Additional Evidence source cache, keyed by objectUuid (the
 * value CaseSourceLink.submissionId holds for an ADDITIONAL relation).
 */
export function collectCaseAttachmentReferences(
  primaryAttachments: SourceDocumentReference[] | undefined,
  sourceLinks: CaseSourceLink[],
  additionalSourcesByObjectUuid: Map<string, AdditionalEvidenceSourceItem>,
): CaseAttachmentReferences {
  const additionalLinks = [...sourceLinks]
    .filter((link) => link.relation === 'ADDITIONAL')
    .sort((a, b) => a.linkedAt.localeCompare(b.linkedAt));

  const references = [...onlyAttachments(primaryAttachments)];
  let missingAdditionalSourceCount = 0;

  for (const link of additionalLinks) {
    const additionalSource = additionalSourcesByObjectUuid.get(link.submissionId);
    if (!additionalSource || !isReadyAdditionalEvidenceSource(additionalSource)) {
      missingAdditionalSourceCount += 1;
      continue;
    }
    references.push(...onlyAttachments(additionalSource.attachments));
  }

  return { references: dedupeByDocumentId(references), missingAdditionalSourceCount };
}

export function buildAttachmentFilenamesOutcome(
  caseReferences: CaseAttachmentReferences, filenamesByDocumentId: Map<string, string>,
): AttachmentFilenamesOutcome {
  const filenames: string[] = [];
  let unresolvedCount = 0;

  for (const reference of caseReferences.references) {
    const filename = filenamesByDocumentId.get(reference.documentId);
    if (filename) {
      filenames.push(filename);
    } else {
      unresolvedCount += 1;
    }
  }

  const warnings: string[] = [];
  if (unresolvedCount > 0) {
    warnings.push(unresolvedCount === 1
      ? 'Bestandsnaam van 1 bijlage kon niet worden geladen.'
      : `Bestandsnamen van ${unresolvedCount} bijlagen konden niet worden geladen.`);
  }
  if (caseReferences.missingAdditionalSourceCount > 0) {
    warnings.push('Gekoppelde extra-bewijzenbron kon niet worden gelezen.');
  }

  return { filenamesText: filenames.join('\n'), ...(warnings.length > 0 ? { warning: warnings.join('\n') } : {}) };
}
