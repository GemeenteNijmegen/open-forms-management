import { CaseStatus } from '../../domain/CaseStatus';
import { positionInOrder, RankingList } from '../domain/Ranking';

export interface RankingDetailViewModel {
  caseReference: string;
  canManage: boolean;
  csrfToken?: string;
  backQuery: string;

  // False only on an actual read error; see buildUnavailableRankingDetailViewModel.
  available: boolean;
  // False when the ranking item does not exist yet at all (before the one-time import).
  initialized: boolean;
  isRanked: boolean;
  position?: number;
  positionLabel?: string;
  total?: number;
  insertMaxPosition?: number;
  revision?: number;
  showWithdrawnWarning: boolean;
}

export function buildRankingDetailViewModel(
  caseReference: string, rankingList: RankingList | undefined, caseStatus: CaseStatus,
  canManage: boolean, backQuery: string, csrfToken?: string,
): RankingDetailViewModel {
  if (!rankingList) {
    return {
      caseReference,
      canManage,
      backQuery,
      ...(csrfToken ? { csrfToken } : {}),
      available: true,
      initialized: false,
      isRanked: false,
      showWithdrawnWarning: false,
    };
  }

  const position = positionInOrder(rankingList.orderedCaseReferences, caseReference);
  const isRanked = position !== undefined;
  const total = rankingList.orderedCaseReferences.length;

  return {
    caseReference,
    canManage,
    backQuery,
    ...(csrfToken ? { csrfToken } : {}),
    available: true,
    initialized: true,
    isRanked,
    total,
    insertMaxPosition: total + 1,
    revision: rankingList.revision,
    ...(isRanked ? { position, positionLabel: `${position} van ${total}` } : {}),
    showWithdrawnWarning: isRanked && caseStatus === 'WITHDRAWN',
  };
}

export function buildUnavailableRankingDetailViewModel(
  caseReference: string, canManage: boolean, backQuery: string, csrfToken?: string,
): RankingDetailViewModel {
  return {
    caseReference,
    canManage,
    backQuery,
    ...(csrfToken ? { csrfToken } : {}),
    available: false,
    initialized: false,
    isRanked: false,
    showWithdrawnWarning: false,
  };
}
