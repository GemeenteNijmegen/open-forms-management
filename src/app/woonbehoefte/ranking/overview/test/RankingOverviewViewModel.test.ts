import { WoonbehoefteCase } from '../../../domain/WoonbehoefteCase';
import { WoonbehoefteCaseWithSource } from '../../../overview/WoonbehoefteOverviewViewModel';
import { ProjectDetailsWorkVersion } from '../../../project-details/domain/ProjectDetails';
import { buildRankingOverviewViewModel } from '../RankingOverviewViewModel';

function entry(caseReference: string, projectName?: string): WoonbehoefteCaseWithSource {
  const woonbehoefteCase: WoonbehoefteCase = {
    caseReference,
    status: 'IN_PROGRESS',
    statusChangedAt: '2026-08-01T00:00:00.000Z',
    assessment: {},
    check: { requested: false },
    version: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    createdBy: 'woonbehoefte-sync-worker',
    updatedAt: '2026-08-01T00:00:00.000Z',
    updatedBy: 'woonbehoefte-sync-worker',
  };
  return {
    woonbehoefteCase,
    ...(projectName
      ? {
        source: {
          status: 'READY',
          cacheVersion: 1,
          objectUuid: `uuid-${caseReference}`,
          submissionId: `uuid-${caseReference}`,
          submissionType: 'PRIMARY_APPLICATION',
          reference: caseReference,
          caseReference,
          formName: 'Aanmelden stroomaansluiting woningbouw',
          registrationAt: '2026-08-01T00:00:00.000Z',
          applicantType: 'UNKNOWN',
          attachments: [],
          cachedAt: '2026-08-01T00:00:00.000Z',
          projectName,
        },
      }
      : {}),
  };
}

describe('buildRankingOverviewViewModel', () => {
  it('sorts ranked cases ascending by position, unranked cases below with a dash', () => {
    const entries = [entry('OF-B', 'Project B'), entry('OF-A', 'Project A'), entry('OF-UNRANKED', 'Project X')];
    const rankByCaseReference = new Map([['OF-B', 2], ['OF-A', 1]]);

    const viewModel = buildRankingOverviewViewModel(entries, rankByCaseReference, new Map(), {});

    expect(viewModel.rows.map((row) => row.caseReference)).toEqual(['OF-A', 'OF-B', 'OF-UNRANKED']);
    expect(viewModel.rows.map((row) => row.rankLabel)).toEqual(['1', '2', '–']);
  });

  it('filters to rank >= N with "Ranking vanaf": unranked cases and lower ranks drop out', () => {
    const entries = [entry('OF-1'), entry('OF-2'), entry('OF-3'), entry('OF-unranked')];
    const rankByCaseReference = new Map([['OF-1', 1], ['OF-2', 2], ['OF-3', 3]]);

    const viewModel = buildRankingOverviewViewModel(entries, rankByCaseReference, new Map(), { rankFrom: 2 });

    expect(viewModel.rows.map((row) => row.caseReference)).toEqual(['OF-2', 'OF-3']);
  });

  it('builds the detail link and prefers the werkversie readableProjectName over the bron projectName', () => {
    const entries = [entry('OF-1', 'Bron projectnaam')];
    const workVersion = { readableProjectName: 'Aangepaste naam' } as ProjectDetailsWorkVersion;

    const withWorkVersion = buildRankingOverviewViewModel(entries, new Map(), new Map([['OF-1', workVersion]]), {});
    const withoutWorkVersion = buildRankingOverviewViewModel(entries, new Map(), new Map(), {});

    expect(withWorkVersion.rows[0].detailHref).toBe('/woonbehoefte/cases/OF-1');
    expect(withWorkVersion.rows[0].projectName).toBe('Aangepaste naam');
    expect(withoutWorkVersion.rows[0].projectName).toBe('Bron projectnaam');
  });
});
