import { RankingOverviewFilter } from './RankingOverviewFilter';
import { CASE_STATUS_LABELS } from '../../domain/CaseLabels';
import { WoonbehoefteCaseWithSource } from '../../overview/WoonbehoefteOverviewViewModel';
import { ProjectDetailsWorkVersion } from '../../project-details/domain/ProjectDetails';

export interface RankingOverviewRow {
  caseReference: string;
  detailHref: string;
  statusLabel: string;
  statusToken: string;
  projectName: string;
  rankLabel: string;
}

export interface RankingOverviewViewModel {
  rows: RankingOverviewRow[];
  hasRows: boolean;
  totalCountLabel: string;
  rankFrom?: number;
}

function rowProjectName(entry: WoonbehoefteCaseWithSource, workVersion: ProjectDetailsWorkVersion | undefined): string {
  if (workVersion?.readableProjectName) {
    return workVersion.readableProjectName;
  }
  if (entry.hasSourceConflict) {
    return 'Bronconflict: meerdere aanvragen met dit OF-nummer';
  }
  return entry.source?.projectName ?? 'Onbekend project (bron nog niet beschikbaar)';
}

export function buildRankingOverviewViewModel(
  entries: WoonbehoefteCaseWithSource[],
  rankByCaseReference: Map<string, number>,
  workVersionsByCaseReference: Map<string, ProjectDetailsWorkVersion>,
  filter: RankingOverviewFilter,
): RankingOverviewViewModel {
  const withRank = entries.map((entry) => ({ entry, rank: rankByCaseReference.get(entry.woonbehoefteCase.caseReference) }));

  const rankFrom = filter.rankFrom;
  const filtered = rankFrom === undefined ? withRank : withRank.filter(({ rank }) => rank !== undefined && rank >= rankFrom);

  // Ranked ascending by position; unranked (rank undefined) sort last, relative order among them is not meaningful.
  const sorted = [...filtered].sort((a, b) => {
    if (a.rank !== undefined && b.rank !== undefined) {
      return a.rank - b.rank;
    }
    if (a.rank !== undefined) {
      return -1;
    }
    if (b.rank !== undefined) {
      return 1;
    }
    return 0;
  });

  return {
    rows: sorted.map(({ entry, rank }) => ({
      caseReference: entry.woonbehoefteCase.caseReference,
      detailHref: `/woonbehoefte/cases/${encodeURIComponent(entry.woonbehoefteCase.caseReference)}`,
      statusLabel: CASE_STATUS_LABELS[entry.woonbehoefteCase.status],
      statusToken: entry.woonbehoefteCase.status.toLowerCase().replace(/_/g, '-'),
      projectName: rowProjectName(entry, workVersionsByCaseReference.get(entry.woonbehoefteCase.caseReference)),
      rankLabel: rank !== undefined ? String(rank) : '–',
    })),
    hasRows: sorted.length > 0,
    totalCountLabel: `${sorted.length} ${sorted.length === 1 ? 'aanvraag' : 'aanvragen'}`,
    ...(rankFrom !== undefined ? { rankFrom } : {}),
  };
}
