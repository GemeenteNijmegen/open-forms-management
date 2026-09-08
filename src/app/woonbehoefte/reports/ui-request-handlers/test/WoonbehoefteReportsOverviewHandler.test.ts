import { AuthorizationService } from '../../../../../shared/authorization/AuthorizationService';
import { PermissionEvaluator } from '../../../../../shared/authorization/PermissionEvaluator';
import { WoonbehoefteReport } from '../../domain/WoonbehoefteReport';
import { WoonbehoefteReportStore } from '../../store/WoonbehoefteReportStore';
import { WoonbehoefteReportsOverviewHandler } from '../WoonbehoefteReportsOverviewHandler';

function makeAuthorizationService(grants: { resource: string; actions: string[] }[]): AuthorizationService {
  const evaluator = new PermissionEvaluator(grants);
  return {
    loadContext: jest.fn().mockResolvedValue({ identity: { principalId: 'employee-1' }, evaluator }),
    requireAuthorization: jest.fn().mockImplementation(async (_context, check) => (evaluator.evaluate(check) === 'ALLOW'
      ? undefined
      : { statusCode: 403 })),
  } as unknown as AuthorizationService;
}

function makeReportStore(reports: WoonbehoefteReport[] = []): WoonbehoefteReportStore {
  return { listRecent: jest.fn().mockResolvedValue(reports) } as unknown as WoonbehoefteReportStore;
}

const filter = { statuses: [], startYears: [], startYearNotSet: false, applicantTypes: [], assignment: 'ALL' as const, checkRequestedOnly: false };

function report(overrides: Partial<WoonbehoefteReport> = {}): WoonbehoefteReport {
  return {
    reportId: 'report-1',
    filter,
    options: { includeAllFormFields: false, includeAttachmentFilenames: false },
    status: 'READY',
    requestedBy: 'medewerker@nijmegen.nl',
    requestedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

describe('WoonbehoefteReportsOverviewHandler', () => {
  it('denies a medewerker without woonbehoefte:exceloverzicht', async () => {
    const handler = new WoonbehoefteReportsOverviewHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['view'] }]), makeReportStore(),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.statusCode).toBe(403);
  });

  it('renders the Excel-overzichten tab as active and an empty state when there are no reports yet', async () => {
    const handler = new WoonbehoefteReportsOverviewHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['exceloverzicht'] }]), makeReportStore(),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('woonbehoefte-tabs__link--active');
    // Excel-only: no Aanvragen/Extra bewijzen tabs, only Excel-overzichten itself.
    expect(response.body).not.toContain('Aanvragen</a>');
    expect(response.body).toContain('Er zijn nog geen Excel-overzichten.');
  });

  it('also shows Aanvragen and Extra bewijzen for a medewerker with both woonbehoefte:view and woonbehoefte:exceloverzicht', async () => {
    const handler = new WoonbehoefteReportsOverviewHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['view', 'exceloverzicht'] }]), makeReportStore(),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.body).toContain('Aanvragen</a>');
    expect(response.body).toContain('Extra bewijzen</a>');
  });

  it('lists a report requested by another medewerker, since reports are not maker-only', async () => {
    const handler = new WoonbehoefteReportsOverviewHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['exceloverzicht'] }]),
      makeReportStore([report({ requestedBy: 'collega@nijmegen.nl', caseCount: 12 })]),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.body).toContain('collega@nijmegen.nl');
    expect(response.body).toContain('12');
    expect(response.body).toContain('/woonbehoefte/overzichten/report-1/download');
  });

  it('does not offer a download link for a report that is not READY', async () => {
    const handler = new WoonbehoefteReportsOverviewHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['exceloverzicht'] }]),
      makeReportStore([report({ status: 'BUILDING' })]),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.body).not.toContain('/woonbehoefte/overzichten/report-1/download');
  });

  it('renders the request form with status/applicantType checkboxes, both option checkboxes, and no Door mij option', async () => {
    const handler = new WoonbehoefteReportsOverviewHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['exceloverzicht'] }]), makeReportStore(),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, undefined);

    expect(response.body).toContain('action="/woonbehoefte/overzichten"');
    expect(response.body).toContain('name="status"');
    expect(response.body).toContain('name="applicantType"');
    expect(response.body).toContain('name="includeAllFormFields"');
    expect(response.body).toContain('name="includeAttachmentFilenames"');
    expect(response.body).not.toContain('Door mij');
    expect(response.body).not.toContain('value="mine"');
  });

  it('shows a flash message for a known status query parameter', async () => {
    const handler = new WoonbehoefteReportsOverviewHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['exceloverzicht'] }]), makeReportStore(),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, { status: 'queued' });

    expect(response.body).toContain('wordt op de achtergrond gemaakt');
  });

  it('shows no flash message for an unknown status query parameter', async () => {
    const handler = new WoonbehoefteReportsOverviewHandler(
      makeAuthorizationService([{ resource: 'woonbehoefte', actions: ['exceloverzicht'] }]), makeReportStore(),
    );

    const response = await handler.handleRequest({ principalId: 'employee-1' }, { status: 'not-a-real-status' });

    expect(response.body).not.toContain('utrecht-alert--success');
  });
});
