import { CaseAttachmentReferences, collectCaseAttachmentReferences } from './WoonbehoefteReportAttachments';
import { AdditionalEvidenceSourceItem } from '../../additional-evidence/domain/AdditionalEvidenceSource';
import { AdditionalEvidenceSourceCacheStore } from '../../additional-evidence/source/AdditionalEvidenceSourceCacheStore';
import { WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { CaseSourceLink } from '../../domain/WoonbehoefteCase';
import { WoonbehoefteCaseWithSource } from '../../overview/WoonbehoefteOverviewViewModel';

const CONCURRENCY = 4;

/**
 * Reads only SOURCE# links per case (never notes/activities), through the same small fixed concurrency
 * pool as the raw form field fetch, then resolves every linked Additional Evidence source in one batched
 * read from the shared source-cache table.
 */
export async function collectWoonbehoefteAttachmentReferences(
  caseRepository: WoonbehoefteCaseRepository,
  additionalSourceCacheStore: AdditionalEvidenceSourceCacheStore,
  entries: WoonbehoefteCaseWithSource[],
): Promise<Map<string, CaseAttachmentReferences>> {
  const sourceLinksByCaseReference = new Map<string, CaseSourceLink[]>();
  let nextIndex = 0;

  async function fetchLinks(index: number): Promise<void> {
    const entry = entries[index];
    const links = await caseRepository.getSourceLinks(entry.woonbehoefteCase.caseReference);
    sourceLinksByCaseReference.set(entry.woonbehoefteCase.caseReference, links);
  }

  async function worker(): Promise<void> {
    while (nextIndex < entries.length) {
      const index = nextIndex;
      nextIndex += 1;
      await fetchLinks(index);
    }
  }

  const workerCount = Math.min(CONCURRENCY, entries.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const objectUuids = [...sourceLinksByCaseReference.values()]
    .flat()
    .filter((link) => link.relation === 'ADDITIONAL')
    .map((link) => link.submissionId);
  const additionalSourcesByObjectUuid: Map<string, AdditionalEvidenceSourceItem> = objectUuids.length > 0
    ? await additionalSourceCacheStore.getItems(objectUuids)
    : new Map();

  const result = new Map<string, CaseAttachmentReferences>();
  for (const entry of entries) {
    const caseReference = entry.woonbehoefteCase.caseReference;
    const sourceLinks = sourceLinksByCaseReference.get(caseReference) ?? [];
    result.set(caseReference, collectCaseAttachmentReferences(entry.source?.attachments, sourceLinks, additionalSourcesByObjectUuid));
  }
  return result;
}
