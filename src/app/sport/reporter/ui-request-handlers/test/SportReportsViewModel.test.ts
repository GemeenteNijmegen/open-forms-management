import { SportReport } from '../../store/SportReport';
import { buildSportReportsViewModel } from '../SportReportsViewModel';

function report(overrides: Partial<SportReport> = {}): SportReport {
  return {
    reportId: 'report-1',
    districts: ['dukenburg'],
    from: '2026-01-01',
    to: '2026-01-31',
    status: 'READY',
    requestedBy: 'medewerker@nijmegen.nl',
    requestedAt: '2026-01-05T10:00:00.000Z',
    updatedAt: '2026-01-05T10:00:00.000Z',
    storageKey: 'reports/report-1.xlsx',
    submissionCount: 3,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

describe('buildSportReportsViewModel', () => {
  it('hides DELETED and expired reports from the normal list', () => {
    const viewModel = buildSportReportsViewModel(
      [report({ reportId: 'deleted', status: 'DELETED' }), report({ reportId: 'expired', expiresAt: Math.floor(Date.now() / 1000) - 1 })],
      ['dukenburg'],
      { from: '2026-01-01', to: '2026-01-31' },
    );

    expect(viewModel.hasReports).toBe(false);
    expect(viewModel.reports).toHaveLength(0);
  });

  it('hides a report entirely once the medewerker no longer sees every district in it, not just its actions', () => {
    const viewModel = buildSportReportsViewModel(
      [report({ districts: ['dukenburg', 'lindenholt'] })],
      ['dukenburg'],
      { from: '2026-01-01', to: '2026-01-31' },
    );

    expect(viewModel.reports).toHaveLength(0);
  });

  it('shows a report with download/delete enabled once the medewerker sees every district in it', () => {
    const viewModel = buildSportReportsViewModel(
      [report({ districts: ['dukenburg', 'lindenholt'] })],
      ['dukenburg', 'lindenholt', 'nijmegenNoord'],
      { from: '2026-01-01', to: '2026-01-31' },
    );

    expect(viewModel.reports[0].canDownload).toBe(true);
    expect(viewModel.reports[0].canDelete).toBe(true);
  });

  it('allows download only when READY, even with full district access', () => {
    const building = buildSportReportsViewModel([report({ status: 'BUILDING' })], ['dukenburg'], { from: '2026-01-01', to: '2026-01-31' });
    const ready = buildSportReportsViewModel([report({ status: 'READY' })], ['dukenburg'], { from: '2026-01-01', to: '2026-01-31' });

    expect(building.reports[0].canDownload).toBe(false);
    expect(building.reports[0].canDelete).toBe(true);
    expect(ready.reports[0].canDownload).toBe(true);
  });

  it('shows the Dutch status labels for every status the list can contain', () => {
    const viewModel = buildSportReportsViewModel(
      [
        report({ reportId: 'q', status: 'QUEUED' }),
        report({ reportId: 'b', status: 'BUILDING' }),
        report({ reportId: 'r', status: 'READY' }),
        report({ reportId: 't', status: 'TOO_LARGE' }),
        report({ reportId: 'f', status: 'FAILED' }),
      ],
      ['dukenburg'],
      { from: '2026-01-01', to: '2026-01-31' },
    );

    expect(viewModel.reports.map((item) => item.statusLabel)).toEqual([
      'Wordt gemaakt', 'Wordt gemaakt', 'Gereed', 'Te groot, kies een kortere periode', 'Mislukt',
    ]);
    expect(viewModel.reports.map((item) => item.statusVariant)).toEqual([
      'building', 'building', 'ready', 'failed', 'failed',
    ]);
  });
});
