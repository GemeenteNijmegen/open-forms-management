import { SportReport } from '../../app/sport/reporter/store/SportReport';
import { buildSportReportsViewModel } from '../../app/sport/reporter/ui-request-handlers/SportReportsViewModel';
import { Feature } from '../../shared/navigation/Feature';
import { PageViewModel } from '../../shared/rendering/Renderer';

const sportFeature: Feature = { id: 'sport', label: 'Sport', route: '/sport', resource: 'sport', action: 'view' };

function reporterPage(actorEmail: string): PageViewModel {
  return { title: 'Sport - Excel-overzichten', features: [sportFeature], currentPath: '/sport/overzichten', actorEmail };
}

const defaults = { from: '2026-08-01', to: '2026-08-22' };

function report(overrides: Partial<SportReport>): SportReport {
  return {
    reportId: 'preview-report',
    districts: ['dukenburg'],
    from: '2026-08-01',
    to: '2026-08-22',
    status: 'READY',
    requestedBy: 'medewerker@nijmegen.nl',
    requestedAt: '2026-08-22T09:00:00.000Z',
    updatedAt: '2026-08-22T09:04:00.000Z',
    expiresAt: Math.floor(new Date('2026-09-21T09:04:00.000Z').getTime() / 1000),
    ...overrides,
  };
}

export const sportReporterEmpty = {
  page: reporterPage('medewerker@nijmegen.nl'),
  data: buildSportReportsViewModel([], ['dukenburg', 'lindenholt'], defaults),
};

export const sportReporterActiveAndReady = {
  page: reporterPage('medewerker@nijmegen.nl'),
  data: buildSportReportsViewModel(
    [
      report({
        reportId: 'preview-building', status: 'BUILDING', districts: ['dukenburg', 'lindenholt'], requestedAt: '2026-08-22T10:00:00.000Z', startedAt: '2026-08-22T10:00:05.000Z',
      }),
      report({
        reportId: 'preview-ready', status: 'READY', districts: ['dukenburg'], submissionCount: 42, storageKey: 'reports/preview-ready.xlsx',
      }),
    ],
    ['dukenburg', 'lindenholt'],
    defaults,
    'Het Excel-overzicht wordt op de achtergrond gemaakt. Gebruik de knop Overzichten opnieuw laden om de status te controleren.',
  ),
};

export const sportReporterTooLargeAndFailed = {
  page: reporterPage('medewerker@nijmegen.nl'),
  data: buildSportReportsViewModel(
    [
      report({ reportId: 'preview-too-large', status: 'TOO_LARGE', districts: ['dukenburg', 'lindenholt'], failureReason: 'TIME_LIMIT_REACHED' }),
      report({ reportId: 'preview-failed', status: 'FAILED', districts: ['dukenburg'], failureReason: 'DOCUMENT_ERROR' }),
    ],
    ['dukenburg', 'lindenholt'],
    defaults,
  ),
};
