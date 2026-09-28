export interface RankingOverviewFilter {
  // "Ranking vanaf": only ranked cases with rank >= this show; unranked cases have nothing to compare, so they drop out.
  rankFrom?: number;
}

export function resolveRankingOverviewFilter(queryStringParameters: Record<string, string | undefined> | undefined): RankingOverviewFilter {
  const raw = Number(queryStringParameters?.rankFrom);
  return Number.isInteger(raw) && raw > 0 ? { rankFrom: raw } : {};
}
