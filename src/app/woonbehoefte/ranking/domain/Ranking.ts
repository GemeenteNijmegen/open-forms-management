export const RANKING_PARTITION_KEY = 'RANKING';
export const RANKING_SORT_KEY = 'CURRENT';

// The one item backing the whole feature: position is the array index, never stored per case.
export interface RankingList {
  orderedCaseReferences: string[];
  // Optimistic-lock guard only, never a historical ranking version.
  revision: number;
  updatedAt: string;
  updatedBy: string;
}

function assertPositionInRange(position: number, min: number, max: number): void {
  if (!Number.isInteger(position) || position < min || position > max) {
    throw new Error(`Position ${position} is out of range [${min}, ${max}]`);
  }
}

export function positionInOrder(orderedCaseReferences: string[], caseReference: string): number | undefined {
  const index = orderedCaseReferences.indexOf(caseReference);
  return index === -1 ? undefined : index + 1;
}

// position may be one past the end (append). Throws if caseReference is already in the list.
export function insertIntoOrder(orderedCaseReferences: string[], caseReference: string, position: number): string[] {
  if (orderedCaseReferences.includes(caseReference)) {
    throw new Error(`Case ${caseReference} is already ranked, cannot insert it again`);
  }
  assertPositionInRange(position, 1, orderedCaseReferences.length + 1);
  const next = [...orderedCaseReferences];
  next.splice(position - 1, 0, caseReference);
  return next;
}

// Throws if caseReference is not currently ranked; a caller must only offer moving an already-ranked case.
export function moveWithinOrder(orderedCaseReferences: string[], caseReference: string, position: number): string[] {
  const currentIndex = orderedCaseReferences.indexOf(caseReference);
  if (currentIndex === -1) {
    throw new Error(`Case ${caseReference} is not ranked, cannot move it`);
  }
  assertPositionInRange(position, 1, orderedCaseReferences.length);
  const withoutCase = [...orderedCaseReferences.slice(0, currentIndex), ...orderedCaseReferences.slice(currentIndex + 1)];
  withoutCase.splice(position - 1, 0, caseReference);
  return withoutCase;
}

// A case that is not in the list is already effectively removed; the caller's no-op check handles that.
export function removeFromOrder(orderedCaseReferences: string[], caseReference: string): string[] {
  return orderedCaseReferences.filter((reference) => reference !== caseReference);
}
