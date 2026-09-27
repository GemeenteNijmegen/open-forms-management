import { buildRankingDetailViewModel, buildUnavailableRankingDetailViewModel } from '../RankingDetailViewModel';

describe('buildRankingDetailViewModel', () => {
  it('is not initialized when there is no ranking item yet', () => {
    const viewModel = buildRankingDetailViewModel('OF-1', undefined, 'IN_PROGRESS', true, '');

    expect(viewModel).toMatchObject({ available: true, initialized: false, isRanked: false, showWithdrawnWarning: false });
  });

  it('shows the 1-based position, total and revision for a ranked case', () => {
    const viewModel = buildRankingDetailViewModel(
      'OF-2', { orderedCaseReferences: ['OF-1', 'OF-2', 'OF-3'], revision: 4 }, 'IN_PROGRESS', true, '',
    );

    expect(viewModel).toMatchObject({
      available: true, initialized: true, isRanked: true, position: 2, positionLabel: '2 van 3', total: 3, insertMaxPosition: 4, revision: 4,
    });
  });

  it('is not ranked when the case is not in the list', () => {
    const viewModel = buildRankingDetailViewModel('OF-UNRANKED', { orderedCaseReferences: ['OF-1'], revision: 1 }, 'IN_PROGRESS', true, '');

    expect(viewModel).toMatchObject({ available: true, initialized: true, isRanked: false, showWithdrawnWarning: false });
  });

  it('shows the withdrawn warning only for a withdrawn case that is still ranked', () => {
    const ranked = buildRankingDetailViewModel('OF-1', { orderedCaseReferences: ['OF-1'], revision: 1 }, 'WITHDRAWN', true, '');
    const unranked = buildRankingDetailViewModel('OF-2', { orderedCaseReferences: ['OF-1'], revision: 1 }, 'WITHDRAWN', true, '');

    expect(ranked.showWithdrawnWarning).toBe(true);
    expect(unranked.showWithdrawnWarning).toBe(false);
  });
});

describe('buildUnavailableRankingDetailViewModel', () => {
  it('marks ranking as unavailable, never ranked, no warning', () => {
    expect(buildUnavailableRankingDetailViewModel('OF-1', true, '')).toMatchObject({
      available: false, initialized: false, isRanked: false, showWithdrawnWarning: false,
    });
  });
});
