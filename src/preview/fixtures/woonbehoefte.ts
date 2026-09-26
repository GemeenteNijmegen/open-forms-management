import {
  buildAdditionalEvidenceCaseLookup, buildAdditionalEvidenceDetailViewModel,
} from '../../app/woonbehoefte/additional-evidence/detail/AdditionalEvidenceDetailViewModel';
import { AdditionalEvidenceCaseDocumentGroup } from '../../app/woonbehoefte/additional-evidence/documents/AdditionalEvidenceCaseDocumentsLoader';
import { AdditionalEvidenceDocumentRow } from '../../app/woonbehoefte/additional-evidence/documents/AdditionalEvidenceDocumentsLoader';
import { ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION, AdditionalEvidenceSourceItem, AdditionalEvidenceSourceRecord } from '../../app/woonbehoefte/additional-evidence/domain/AdditionalEvidenceSource';
import { resolveAdditionalEvidenceOverviewFilter } from '../../app/woonbehoefte/additional-evidence/overview/AdditionalEvidenceOverviewFilter';
import { buildAdditionalEvidenceOverviewViewModel, joinWorkItemsWithSources } from '../../app/woonbehoefte/additional-evidence/overview/AdditionalEvidenceOverviewViewModel';
import { AdditionalEvidenceWorkItem } from '../../app/woonbehoefte/additional-evidence/persistence/AdditionalEvidenceRepository';
import { buildWoonbehoefteDetailViewModel } from '../../app/woonbehoefte/detail/WoonbehoefteDetailViewModel';
import { WoonbehoefteDocumentRow } from '../../app/woonbehoefte/documents/WoonbehoefteDocumentsLoader';
import { CaseActivity, CaseNote, WoonbehoefteCase } from '../../app/woonbehoefte/domain/WoonbehoefteCase';
import { WoonbehoefteSourceRecord } from '../../app/woonbehoefte/domain/WoonbehoefteSource';
import { resolveWoonbehoefteOverviewFilter } from '../../app/woonbehoefte/overview/WoonbehoefteOverviewFilter';
import { buildWoonbehoefteOverviewViewModel, joinCasesWithSources } from '../../app/woonbehoefte/overview/WoonbehoefteOverviewViewModel';
import { FacilityLine, HousingLine, KovaLine, ProjectDetailsWorkVersion } from '../../app/woonbehoefte/project-details/domain/ProjectDetails';
import { ProjectPolygon } from '../../app/woonbehoefte/project-details/location/ProjectLocation';
import { buildProjectDetailsViewModel } from '../../app/woonbehoefte/project-details/ui/ProjectDetailsViewModel';
import { WoonbehoefteReport } from '../../app/woonbehoefte/reports/domain/WoonbehoefteReport';
import {
  buildWoonbehoefteReportRequestFormViewModel, buildWoonbehoefteReportsListViewModel,
} from '../../app/woonbehoefte/reports/ui-request-handlers/WoonbehoefteReportsViewModel';
import { buildWoonbehoefteTabs } from '../../app/woonbehoefte/WoonbehoefteTabs';
import { Feature } from '../../shared/navigation/Feature';
import { PageViewModel } from '../../shared/rendering/Renderer';

const woonbehoefteFeature: Feature = { id: 'woonbehoefte', label: 'Woonbehoefte', route: '/woonbehoefte', resource: 'woonbehoefte', action: 'view' };

function woonbehoeftePage(actorEmail: string): PageViewModel {
  return { title: 'Woonbehoefte', features: [woonbehoefteFeature], currentPath: '/woonbehoefte', actorEmail };
}

function source(overrides: Partial<WoonbehoefteSourceRecord> & { caseReference: string }): WoonbehoefteSourceRecord {
  return {
    status: 'READY',
    cacheVersion: 1,
    objectUuid: `preview-${overrides.caseReference}`,
    submissionId: `preview-${overrides.caseReference}`,
    submissionType: 'PRIMARY_APPLICATION',
    reference: overrides.caseReference,
    formName: 'Aanmelden stroomaansluiting woningbouw',
    registrationAt: '2026-08-20T10:15:00.000Z',
    applicantType: 'UNKNOWN',
    attachments: [],
    cachedAt: '2026-08-20T10:15:00.000Z',
    ...overrides,
  };
}

function woonbehoefteCase(overrides: Partial<WoonbehoefteCase> & { caseReference: string }): WoonbehoefteCase {
  return {
    status: 'NEW',
    statusChangedAt: '2026-08-20T10:15:00.000Z',
    assessment: {},
    check: { requested: false },
    version: 1,
    createdAt: '2026-08-20T10:15:00.000Z',
    createdBy: 'woonbehoefte-sync-worker',
    updatedAt: '2026-08-20T10:15:00.000Z',
    updatedBy: 'woonbehoefte-sync-worker',
    ...overrides,
  };
}

const cases: WoonbehoefteCase[] = [
  woonbehoefteCase({
    caseReference: 'OF-2026-00142',
    status: 'IN_PROGRESS',
    statusChangedAt: '2026-08-20T10:15:00.000Z',
    claimedBy: 'medewerker@example.invalid',
    assessment: { assessedStartPeriod: 202808, assessedProjectReadiness: 1 },
  }),
  woonbehoefteCase({ caseReference: 'OF-2026-00151', status: 'NEW' }),
  woonbehoefteCase({
    caseReference: 'OF-2026-00098',
    status: 'WAITING_FOR_ADDITIONAL_INFORMATION',
    statusChangedAt: '2026-08-19T14:30:00.000Z',
    claimedBy: 'andere-medewerker@example.invalid',
    check: { requested: true },
  }),
  woonbehoefteCase({
    caseReference: 'OF-2026-00075',
    status: 'PROPOSED_INADMISSIBLE',
    statusChangedAt: '2026-08-18T09:00:00.000Z',
    claimedBy: 'medewerker@example.invalid',
    check: { requested: true },
  }),
  woonbehoefteCase({
    caseReference: 'OF-2026-00061',
    status: 'READY_FOR_RANKING',
    statusChangedAt: '2026-08-17T10:00:00.000Z',
    claimedBy: 'medewerker@example.invalid',
    assessment: { assessedStartPeriod: 202906 },
  }),
  woonbehoefteCase({
    caseReference: 'OF-2026-00033',
    status: 'INADMISSIBLE',
    statusChangedAt: '2026-08-15T11:00:00.000Z',
    claimedBy: 'medewerker@example.invalid',
  }),
];

const sources: WoonbehoefteSourceRecord[] = [
  source({
    caseReference: 'OF-2026-00142',
    projectName: 'Nieuwbouwproject Dukenburg',
    contactName: 'Test Contact Dukenburg',
    contactEmail: 'test-dukenburg@example.invalid',
    applicantType: 'PROJECT_APPLICANT',
    registrationAt: '2026-08-20T10:15:00.000Z',
  }),
  source({
    caseReference: 'OF-2026-00151',
    projectName: 'Verbouwing Nijmegen-Noord',
    contactName: 'Test Contact Noord',
    contactEmail: 'test-noord@example.invalid',
    applicantType: 'INDIVIDUAL',
    registrationAt: '2026-08-21T09:00:00.000Z',
  }),
  source({
    caseReference: 'OF-2026-00098',
    projectName: 'Woonzorgcomplex Centrum',
    contactName: 'Test Contact Centrum',
    contactEmail: 'test-centrum@example.invalid',
    applicantType: 'PROJECT_APPLICANT',
    isCollectiveHousing: true,
    registrationAt: '2026-08-19T14:30:00.000Z',
  }),
  source({
    caseReference: 'OF-2026-00075',
    projectName: 'Uitbreiding sportpark Oost',
    contactName: 'Test Contact Oost',
    contactEmail: 'test-oost@example.invalid',
    applicantType: 'MUNICIPALITY_NIJMEGEN',
    registrationAt: '2026-08-18T09:00:00.000Z',
  }),
  source({
    caseReference: 'OF-2026-00033',
    projectName: 'Aanvraag zonder rechtsgeldige onderbouwing',
    contactName: 'Test Contact OudNieuwWest',
    contactEmail: 'test-oudnieuwwest@example.invalid',
    applicantType: 'PROJECT_APPLICANT',
    registrationAt: '2026-08-14T16:30:00.000Z',
  }),
  // OF-2026-00061 has no matching source: shows the fallback "bron nog niet beschikbaar" project label.
];

export const woonbehoefteOverviewWithMix = {
  page: woonbehoeftePage('medewerker@example.invalid'),
  data: {
    ...buildWoonbehoefteOverviewViewModel(joinCasesWithSources(cases, sources), resolveWoonbehoefteOverviewFilter(undefined), 'medewerker@example.invalid'),
    canManage: true,
    tabs: buildWoonbehoefteTabs('aanvragen', true, true),
    csrfToken: 'preview-csrf-token',
    isRefreshing: false,
    refreshStarted: false,
    refreshAlreadyRunning: false,
  },
};

// De vijf nieuwe statussen naast elkaar: geel/oranje/groen/groen/rood, en de lengte van "Correctie wacht op antwoord" naast de kortere labels.
const casesWithNewStatuses: WoonbehoefteCase[] = [
  woonbehoefteCase({ caseReference: 'OF-2026-00301', status: 'READY_FOR_RANKING', claimedBy: 'medewerker@example.invalid' }),
  woonbehoefteCase({ caseReference: 'OF-2026-00302', status: 'CORRECTION_NEEDED', claimedBy: 'medewerker@example.invalid' }),
  woonbehoefteCase({ caseReference: 'OF-2026-00303', status: 'CORRECTION_WAITING_FOR_RESPONSE', claimedBy: 'medewerker@example.invalid' }),
  woonbehoefteCase({ caseReference: 'OF-2026-00304', status: 'READY_MIJN_AANSLUITING', claimedBy: 'medewerker@example.invalid' }),
  woonbehoefteCase({ caseReference: 'OF-2026-00305', status: 'CAPACITY_MA_SUBMITTED', claimedBy: 'medewerker@example.invalid' }),
  woonbehoefteCase({ caseReference: 'OF-2026-00306', status: 'WITHDRAWN', claimedBy: 'medewerker@example.invalid' }),
];

const sourcesForNewStatuses: WoonbehoefteSourceRecord[] = [
  source({ caseReference: 'OF-2026-00301', projectName: 'Nieuwbouwproject Hatertseveld', applicantType: 'PROJECT_APPLICANT' }),
  source({ caseReference: 'OF-2026-00302', projectName: 'Verbouwing Bottendaal', applicantType: 'INDIVIDUAL' }),
  source({ caseReference: 'OF-2026-00303', projectName: 'Nieuwbouw Weezenhof fase 2', applicantType: 'PROJECT_APPLICANT' }),
  source({ caseReference: 'OF-2026-00304', projectName: 'Uitbreiding zorgcomplex Hees', applicantType: 'PROJECT_APPLICANT' }),
  source({ caseReference: 'OF-2026-00305', projectName: 'Nieuwbouw Grootstal', applicantType: 'MUNICIPALITY_NIJMEGEN' }),
  source({ caseReference: 'OF-2026-00306', projectName: 'Ingetrokken aanvraag Neerbosch', applicantType: 'INDIVIDUAL' }),
];

export const woonbehoefteOverviewNewStatuses = {
  page: woonbehoeftePage('medewerker@example.invalid'),
  data: {
    ...buildWoonbehoefteOverviewViewModel(
      joinCasesWithSources(casesWithNewStatuses, sourcesForNewStatuses), resolveWoonbehoefteOverviewFilter(undefined), 'medewerker@example.invalid',
    ),
    canManage: true,
    tabs: buildWoonbehoefteTabs('aanvragen', true, true),
    csrfToken: 'preview-csrf-token',
    isRefreshing: false,
    refreshStarted: false,
    refreshAlreadyRunning: false,
  },
};

// Toont de uitgebreide statusfilter (elf opties) met een aantal van de nieuwe statussen al aangevinkt.
export const woonbehoefteOverviewNewStatusesFilterSelected = {
  page: woonbehoeftePage('medewerker@example.invalid'),
  data: {
    ...buildWoonbehoefteOverviewViewModel(
      joinCasesWithSources(casesWithNewStatuses, sourcesForNewStatuses),
      resolveWoonbehoefteOverviewFilter({ status: 'CORRECTION_NEEDED,CORRECTION_WAITING_FOR_RESPONSE,READY_MIJN_AANSLUITING,CAPACITY_MA_SUBMITTED,WITHDRAWN' }),
      'medewerker@example.invalid',
    ),
    canManage: true,
    tabs: buildWoonbehoefteTabs('aanvragen', true, true),
    csrfToken: 'preview-csrf-token',
    isRefreshing: false,
    refreshStarted: false,
    refreshAlreadyRunning: false,
  },
};

export const woonbehoefteOverviewEmpty = {
  page: woonbehoeftePage('medewerker@example.invalid'),
  data: {
    ...buildWoonbehoefteOverviewViewModel([], resolveWoonbehoefteOverviewFilter(undefined), 'medewerker@example.invalid'),
    canManage: true,
    tabs: buildWoonbehoefteTabs('aanvragen', true, true),
    csrfToken: 'preview-csrf-token',
    isRefreshing: false,
    refreshStarted: false,
    refreshAlreadyRunning: false,
  },
};

export const woonbehoefteOverviewViewOnly = {
  page: woonbehoeftePage('kijker@example.invalid'),
  data: {
    ...buildWoonbehoefteOverviewViewModel(joinCasesWithSources(cases, sources), resolveWoonbehoefteOverviewFilter(undefined), 'kijker@example.invalid'),
    canManage: false,
    tabs: buildWoonbehoefteTabs('aanvragen', true, false),
    isRefreshing: false,
    refreshStarted: false,
    refreshAlreadyRunning: false,
  },
};

function reportsPage(): PageViewModel {
  return { ...woonbehoeftePage('medewerker@example.invalid'), title: 'Woonbehoefte - Excel-overzichten', currentPath: '/woonbehoefte/overzichten' };
}

const emptyReportFilter = {
  statuses: [], startYears: [], startYearNotSet: false, applicantTypes: [], assignment: 'ALL' as const, checkRequestedOnly: false,
};

function woonbehoefteReport(overrides: Partial<WoonbehoefteReport> & { reportId: string }): WoonbehoefteReport {
  return {
    filter: emptyReportFilter,
    options: { includeAllFormFields: false, includeAttachmentFilenames: false },
    status: 'READY',
    requestedBy: 'medewerker@example.invalid',
    requestedAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
    expiresAt: Math.floor(new Date('2026-10-01T09:00:00.000Z').getTime() / 1000),
    ...overrides,
  };
}

const reportsMix: WoonbehoefteReport[] = [
  woonbehoefteReport({
    reportId: 'report-ready', status: 'READY', requestedBy: 'collega@example.invalid', caseCount: 128, warningCount: 3,
  }),
  woonbehoefteReport({
    reportId: 'report-building', status: 'BUILDING', requestedAt: '2026-09-08T10:00:00.000Z', updatedAt: '2026-09-08T10:01:00.000Z',
  }),
  woonbehoefteReport({
    reportId: 'report-failed', status: 'FAILED', requestedAt: '2026-09-05T08:00:00.000Z', updatedAt: '2026-09-05T08:03:00.000Z',
  }),
  woonbehoefteReport({
    reportId: 'report-too-large', status: 'TOO_LARGE', options: { includeAllFormFields: true, includeAttachmentFilenames: true },
  }),
];

export const woonbehoefteReportsOverview = {
  page: reportsPage(),
  data: {
    ...buildWoonbehoefteReportsListViewModel(reportsMix),
    ...buildWoonbehoefteReportRequestFormViewModel(),
    tabs: buildWoonbehoefteTabs('exceloverzichten', true, true),
    csrfToken: 'preview-csrf-token',
  },
};

export const woonbehoefteReportsOverviewEmpty = {
  page: reportsPage(),
  data: {
    ...buildWoonbehoefteReportsListViewModel([]),
    ...buildWoonbehoefteReportRequestFormViewModel(),
    tabs: buildWoonbehoefteTabs('exceloverzichten', false, true),
    csrfToken: 'preview-csrf-token',
  },
};

function additionalEvidencePage(): PageViewModel {
  return { ...woonbehoeftePage('medewerker@example.invalid'), title: 'Woonbehoefte - Extra bewijzen' };
}

function additionalEvidenceWorkItem(overrides: Partial<AdditionalEvidenceWorkItem> & { objectUuid: string }): AdditionalEvidenceWorkItem {
  return {
    submissionReference: `OF-${overrides.objectUuid}`,
    status: 'NEW',
    createdAt: '2026-09-07T18:00:00.000Z',
    createdBy: 'additional-evidence-sync-worker',
    ...overrides,
  };
}

function additionalEvidenceSource(
  overrides: Partial<AdditionalEvidenceSourceRecord> & { objectUuid: string; submittedAt: string },
): AdditionalEvidenceSourceRecord {
  return {
    status: 'READY',
    cacheVersion: ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION,
    submissionId: overrides.objectUuid,
    reference: `OF-${overrides.objectUuid}`,
    formName: 'Extra bewijzen stroomaansluiting woningbouw',
    originalCaseReference: 'OF-2026-00142',
    attachments: [],
    cachedAt: '2026-09-07T18:00:00.000Z',
    ...overrides,
  };
}

const additionalEvidenceWorkItems: AdditionalEvidenceWorkItem[] = [
  additionalEvidenceWorkItem({ objectUuid: 'uuid-extra-01', status: 'NEW' }),
  additionalEvidenceWorkItem({ objectUuid: 'uuid-extra-02', status: 'UNKNOWN' }),
  additionalEvidenceWorkItem({ objectUuid: 'uuid-extra-03', status: 'LINKED' }),
  additionalEvidenceWorkItem({ objectUuid: 'uuid-extra-04', status: 'NEW' }),
];

const additionalEvidenceSources = new Map<string, AdditionalEvidenceSourceItem>([
  ['uuid-extra-01', additionalEvidenceSource({
    objectUuid: 'uuid-extra-01',
    submittedAt: '2026-09-07T17:54:04.702Z',
    submittedProjectName: 'Project Lindenhof',
    contactEmail: 'burger@example.invalid',
    contactPhone: '0612345678',
    evidenceDescription: 'Aanvullende planning en ondertekende overeenkomst.',
    remarks: 'Graag meenemen bij de beoordeling.',
  })],
  ['uuid-extra-02', additionalEvidenceSource({ objectUuid: 'uuid-extra-02', submittedAt: '2026-09-06T09:15:00.000Z', submittedProjectName: 'Project Zonnehof' })],
  ['uuid-extra-03', additionalEvidenceSource({ objectUuid: 'uuid-extra-03', submittedAt: '2026-09-05T11:00:00.000Z', submittedProjectName: 'Project Meijhorst' })],
  // uuid-extra-04 has no source record at all: Object was valid but the CSV fetch failed (bronfout).
  ['uuid-extra-04', { status: 'FAILED', objectUuid: 'uuid-extra-04', failureReasonCode: 'CSV_FETCH_ERROR', lastAttemptAt: '2026-09-07T19:00:00.000Z' }],
]);

const additionalEvidenceEntries = joinWorkItemsWithSources(additionalEvidenceWorkItems, additionalEvidenceSources);
const additionalEvidenceFilter = resolveAdditionalEvidenceOverviewFilter(undefined);

const additionalEvidenceSearchFilter = resolveAdditionalEvidenceOverviewFilter({ search: 'Lindenhof' });

export const woonbehoefteAdditionalEvidenceOverviewSearch = {
  page: additionalEvidencePage(),
  data: {
    ...buildAdditionalEvidenceOverviewViewModel(additionalEvidenceEntries, additionalEvidenceSearchFilter, ''),
    tabs: buildWoonbehoefteTabs('additional-evidence', true, true),
    csrfToken: 'preview-csrf-token',
    isRefreshing: false,
    refreshStarted: false,
    refreshAlreadyRunning: false,
    refreshFailed: false,
  },
};

export const woonbehoefteAdditionalEvidenceOverview = {
  page: additionalEvidencePage(),
  data: {
    ...buildAdditionalEvidenceOverviewViewModel(additionalEvidenceEntries, additionalEvidenceFilter, ''),
    tabs: buildWoonbehoefteTabs('additional-evidence', true, true),
    csrfToken: 'preview-csrf-token',
    isRefreshing: false,
    refreshStarted: false,
    refreshAlreadyRunning: false,
    refreshFailed: false,
  },
};

function additionalEvidenceDetailPage(submissionReference: string): PageViewModel {
  return { title: `${submissionReference} - Woonbehoefte`, features: [woonbehoefteFeature], currentPath: '/woonbehoefte/additional-evidence/uuid-extra-01', actorEmail: 'medewerker@example.invalid' };
}

function additionalEvidenceDocumentRow(overrides: Partial<AdditionalEvidenceDocumentRow> & { documentId: string }): AdditionalEvidenceDocumentRow {
  return {
    filenameLabel: 'Bijlage', downloadHref: `/woonbehoefte/additional-evidence/uuid-extra-01/documents/${overrides.documentId}`, isApplicationPdf: false, ...overrides,
  };
}

export const woonbehoefteAdditionalEvidenceDetailNormal = {
  page: additionalEvidenceDetailPage('OF-EXTRA01'),
  data: buildAdditionalEvidenceDetailViewModel(
    additionalEvidenceWorkItem({ objectUuid: 'uuid-extra-01', status: 'NEW' }),
    additionalEvidenceSource({
      objectUuid: 'uuid-extra-01',
      submittedAt: '2026-09-07T17:54:04.702Z',
      submittedProjectName: 'Project Lindenhof',
      contactEmail: 'burger@example.invalid',
      contactPhone: '0612345678',
      evidenceDescription: 'Aanvullende planning en ondertekende overeenkomst.',
      remarks: 'Graag meenemen bij de beoordeling.',
    }),
    'READY',
    [
      additionalEvidenceDocumentRow({ documentId: 'pdf-1', filenameLabel: 'Extra-bewijzenformulier (PDF)', isApplicationPdf: true, formatLabel: 'application/pdf' }),
      additionalEvidenceDocumentRow({ documentId: 'att-1', filenameLabel: 'situatietekening.pdf', formatLabel: 'application/pdf', sizeLabel: '482 KB' }),
    ],
    true,
    '',
    'preview-csrf-token',
  ),
};

export const woonbehoefteAdditionalEvidenceDetailSourceError = {
  page: additionalEvidenceDetailPage('OF-EXTRA04'),
  data: buildAdditionalEvidenceDetailViewModel(
    additionalEvidenceWorkItem({ objectUuid: 'uuid-extra-04', status: 'NEW' }),
    undefined,
    'FAILED',
    [],
    true,
    '',
    'preview-csrf-token',
  ),
};

// Reuses the existing OF-2026-00142 hoofdzaak/source fixtures, so the "gevonden" preview lines up with
// what the primary Woonbehoefte-previews already show for that same case.
const previewFoundCase = cases.find((c) => c.caseReference === 'OF-2026-00142')!;
const previewFoundPrimarySource = sources.find((s) => s.caseReference === 'OF-2026-00142');

export const woonbehoefteAdditionalEvidenceDetailCaseFound = {
  page: additionalEvidenceDetailPage('OF-EXTRA01'),
  data: buildAdditionalEvidenceDetailViewModel(
    additionalEvidenceWorkItem({ objectUuid: 'uuid-extra-01', status: 'NEW' }),
    additionalEvidenceSource({ objectUuid: 'uuid-extra-01', submittedAt: '2026-09-07T17:54:04.702Z', submittedProjectName: 'Project Lindenhof' }),
    'READY',
    [],
    true,
    '',
    'preview-csrf-token',
    buildAdditionalEvidenceCaseLookup('OF-2026-00142', previewFoundCase, previewFoundPrimarySource, true),
  ),
};

export const woonbehoefteAdditionalEvidenceDetailCaseNotFound = {
  page: additionalEvidenceDetailPage('OF-EXTRA03'),
  data: buildAdditionalEvidenceDetailViewModel(
    additionalEvidenceWorkItem({ objectUuid: 'uuid-extra-03', status: 'NEW' }),
    additionalEvidenceSource({ objectUuid: 'uuid-extra-03', submittedAt: '2026-09-05T11:00:00.000Z', submittedProjectName: 'Project Meijhorst' }),
    'READY',
    [],
    true,
    '',
    'preview-csrf-token',
    buildAdditionalEvidenceCaseLookup('OF-BESTAAT-NIET', undefined, undefined, false),
  ),
};

export const woonbehoefteAdditionalEvidenceDetailLinked = {
  page: additionalEvidenceDetailPage('OF-EXTRA01'),
  data: buildAdditionalEvidenceDetailViewModel(
    additionalEvidenceWorkItem({
      objectUuid: 'uuid-extra-01', status: 'LINKED', linkedCaseReference: 'OF-2026-00142', linkedAt: '2026-09-09T10:32:00.000Z', linkedBy: 'medewerker@example.invalid',
    }),
    additionalEvidenceSource({ objectUuid: 'uuid-extra-01', submittedAt: '2026-09-07T17:54:04.702Z', submittedProjectName: 'Project Lindenhof' }),
    'READY',
    [],
    true,
    '',
    'preview-csrf-token',
    undefined,
    previewFoundPrimarySource,
  ),
};

function detailPage(caseReference: string): PageViewModel {
  return { title: `${caseReference} - Woonbehoefte`, features: [woonbehoefteFeature], currentPath: `/woonbehoefte/cases/${caseReference}`, actorEmail: 'medewerker@example.invalid' };
}

function documentRow(overrides: Partial<WoonbehoefteDocumentRow> & { documentId: string }): WoonbehoefteDocumentRow {
  return { filenameLabel: 'Bijlage', originLabel: 'Oorspronkelijke aanvraag', downloadHref: `/woonbehoefte/cases/OF-2026-00142/documents/${overrides.documentId}`, isApplicationPdf: false, ...overrides };
}

const detailCase = woonbehoefteCase({
  caseReference: 'OF-2026-00142',
  status: 'IN_PROGRESS',
  statusChangedAt: '2026-08-20T10:15:00.000Z',
  claimedBy: 'medewerker@example.invalid',
  check: { requested: true, requestedBy: 'medewerker@example.invalid', requestedAt: '2026-08-21T08:00:00.000Z' },
  assessment: {
    applicationComplete: 'YES',
    boardDeclarationApproved: 'YES',
    chamberOfCommerceApproved: 'UNKNOWN',
    assessedStartPeriod: 202808,
    assessedStartExplanation: 'Aannemer bevestigt startdatum telefonisch.',
    assessedProjectReadiness: 1,
  },
});

const detailSource = source({
  caseReference: 'OF-2026-00142',
  projectName: 'Nieuwbouwproject Dukenburg',
  projectDescription: 'Realisatie van 10 grondgebonden woningen in twee bouwfasen.',
  contactName: 'Test Contact Dukenburg',
  contactPhone: '0600000001',
  contactEmail: 'test-dukenburg@example.invalid',
  totalHomes: 10,
  hasExistingLianderRequest: false,
  applicantType: 'PROJECT_APPLICANT',
  isCollectiveHousing: true,
  hasCollectiveFacilities: true,
  hasKova: false,
  collectiveHousingCategory: 'jeugdwet',
  submittedStartDate: '2028-08-30',
  submittedCompletionDate: '2030-08-16',
  submittedProjectReadiness: 1,
});

const detailNote: CaseNote = {
  noteId: 'preview-note-1',
  caseReference: 'OF-2026-00142',
  category: 'CONTACT',
  text: 'Aanvrager gebeld over ontbrekend bestuursverklaring-document.',
  createdAt: '2026-08-21T09:30:00.000Z',
  createdBy: 'medewerker@example.invalid',
};

const detailActivity: CaseActivity = {
  activityId: 'preview-activity-1',
  caseReference: 'OF-2026-00142',
  type: 'CASE_CLAIMED',
  actor: 'medewerker@example.invalid',
  occurredAt: '2026-08-21T09:00:00.000Z',
  summary: 'Zaak opgepakt door medewerker@example.invalid',
};

export const woonbehoefteDetailNormal = {
  page: detailPage('OF-2026-00142'),
  data: buildWoonbehoefteDetailViewModel(
    detailCase, detailSource, 'READY',
    [
      documentRow({ documentId: 'pdf-1', filenameLabel: 'Aanvraagformulier (PDF)', isApplicationPdf: true, formatLabel: 'application/pdf', sizeLabel: '842 KB' }),
      documentRow({ documentId: 'att-1', filenameLabel: 'bestuursverklaring.pdf', formatLabel: 'application/pdf', sizeLabel: '211 KB' }),
      documentRow({ documentId: 'att-2', filenameLabel: 'kvk-uittreksel.pdf', formatLabel: 'application/pdf', sizeLabel: '98 KB' }),
    ],
    [detailNote], [detailActivity], true, 'medewerker@example.invalid', '', 'preview-csrf-token',
  ),
};

export const woonbehoefteDetailSourceError = {
  page: detailPage('OF-2026-00075'),
  data: buildWoonbehoefteDetailViewModel(
    woonbehoefteCase({ caseReference: 'OF-2026-00075', status: 'NEW' }), undefined, 'FAILED', [], [], [], true, 'medewerker@example.invalid', '', 'preview-csrf-token',
  ),
};

export const woonbehoefteDetailManyDocuments = {
  page: detailPage('OF-2026-00061'),
  data: buildWoonbehoefteDetailViewModel(
    woonbehoefteCase({ caseReference: 'OF-2026-00061', status: 'IN_PROGRESS', claimedBy: 'medewerker@example.invalid' }),
    source({ caseReference: 'OF-2026-00061', projectName: 'Uitbreiding wijkcentrum Lindenholt', applicantType: 'MUNICIPALITY_NIJMEGEN' }),
    'READY',
    [
      documentRow({ documentId: 'pdf-1', filenameLabel: 'Aanvraagformulier (PDF)', isApplicationPdf: true }),
      ...Array.from({ length: 12 }, (_, index) => documentRow({ documentId: `att-${index + 1}`, filenameLabel: `foto-${index + 1}.jpg`, formatLabel: 'image/jpeg' })),
    ],
    [], [], true, 'medewerker@example.invalid', '', 'preview-csrf-token',
  ),
};

export const woonbehoefteDetailProposedInadmissible = {
  page: detailPage('OF-2026-00075'),
  data: buildWoonbehoefteDetailViewModel(
    woonbehoefteCase({
      caseReference: 'OF-2026-00075',
      status: 'PROPOSED_INADMISSIBLE',
      claimedBy: 'medewerker@example.invalid',
      check: { requested: true, requestedBy: 'medewerker@example.invalid', requestedAt: '2026-08-18T09:00:00.000Z' },
    }),
    source({ caseReference: 'OF-2026-00075', projectName: 'Uitbreiding sportpark Oost', applicantType: 'MUNICIPALITY_NIJMEGEN' }),
    'READY', [], [], [], true, 'medewerker@example.invalid', '', 'preview-csrf-token',
  ),
};

// Zaak in één van de nieuwe gewone statussen: de select toont alle negen gewone statussen in de vaste volgorde, Ingetrokken onderaan.
export const woonbehoefteDetailCorrectionNeeded = {
  page: detailPage('OF-2026-00302'),
  data: buildWoonbehoefteDetailViewModel(
    woonbehoefteCase({ caseReference: 'OF-2026-00302', status: 'CORRECTION_NEEDED', claimedBy: 'medewerker@example.invalid' }),
    source({ caseReference: 'OF-2026-00302', projectName: 'Verbouwing Bottendaal', applicantType: 'INDIVIDUAL' }),
    'READY', [], [], [], true, 'medewerker@example.invalid', '', 'preview-csrf-token',
  ),
};

export const woonbehoefteDetailInadmissible = {
  page: detailPage('OF-2026-00033'),
  data: buildWoonbehoefteDetailViewModel(
    woonbehoefteCase({ caseReference: 'OF-2026-00033', status: 'INADMISSIBLE', claimedBy: 'medewerker@example.invalid' }),
    source({ caseReference: 'OF-2026-00033', projectName: 'Aanvraag zonder rechtsgeldige onderbouwing', applicantType: 'PROJECT_APPLICANT' }),
    'READY', [], [], [], true, 'medewerker@example.invalid', '', 'preview-csrf-token',
  ),
};

function additionalDocumentGroup(
  overrides: Partial<AdditionalEvidenceCaseDocumentGroup> & { submissionReference: string },
): AdditionalEvidenceCaseDocumentGroup {
  return {
    submittedAtLabel: '7 september 2026 17:54',
    linkedAtLabel: '9 september 2026 10:32',
    linkedByLabel: 'medewerker@example.invalid',
    hasSourceError: false,
    documents: [
      { documentId: 'extra-pdf-1', filenameLabel: 'Extra-bewijzenformulier (PDF)', formatLabel: 'application/pdf', downloadHref: '/woonbehoefte/cases/OF-2026-00142/documents/extra-pdf-1' },
    ],
    hasDocuments: true,
    ...overrides,
  };
}

export const woonbehoefteDetailWithAdditionalEvidence = {
  page: detailPage('OF-2026-00142'),
  data: buildWoonbehoefteDetailViewModel(
    detailCase, detailSource, 'READY',
    [documentRow({ documentId: 'pdf-1', filenameLabel: 'Aanvraagformulier (PDF)', isApplicationPdf: true, formatLabel: 'application/pdf', sizeLabel: '842 KB' })],
    [detailNote], [detailActivity], true, 'medewerker@example.invalid', '', 'preview-csrf-token',
    [
      additionalDocumentGroup({ submissionReference: 'OF-EXTRA01' }),
      additionalDocumentGroup({
        submissionReference: 'OF-EXTRA02',
        hasSourceError: true,
        sourceErrorMessage: 'De brongegevens van deze extra-bewijzeninzending konden niet volledig worden gelezen. Ververs Extra bewijzen later opnieuw.',
        documents: [],
        hasDocuments: false,
      }),
    ],
  ),
};

export const woonbehoefteDetailViewOnly = {
  page: detailPage('OF-2026-00142'),
  data: buildWoonbehoefteDetailViewModel(
    detailCase, detailSource, 'READY',
    [documentRow({ documentId: 'pdf-1', filenameLabel: 'Aanvraagformulier (PDF)', isApplicationPdf: true })],
    [detailNote], [detailActivity], false, 'kijker@example.invalid', '',
  ),
};

export const woonbehoefteDetailSaved = {
  page: detailPage('OF-2026-00142'),
  data: {
    ...buildWoonbehoefteDetailViewModel(
      detailCase, detailSource, 'READY',
      [documentRow({ documentId: 'pdf-1', filenameLabel: 'Aanvraagformulier (PDF)', isApplicationPdf: true, formatLabel: 'application/pdf', sizeLabel: '842 KB' })],
      [detailNote], [detailActivity], true, 'medewerker@example.invalid', '', 'preview-csrf-token',
    ),
    savedMessage: 'Beoordeling opgeslagen. Controleer of de status van de aanvraag nog klopt.',
  },
};

// Fictieve, niet uit een echt dossier afkomstige polygonen (zie 01-context.md: geen echte dossierdata in previews).
const PREVIEW_SOURCE_POLYGON: ProjectPolygon = {
  type: 'Polygon',
  coordinates: [[[5.811185, 51.851814], [5.846297, 51.851682], [5.846124, 51.83477], [5.811026, 51.834902], [5.811185, 51.851814]]],
};
const PREVIEW_MANUAL_POLYGON: ProjectPolygon = {
  type: 'Polygon',
  coordinates: [[[5.858952, 51.84241], [5.859964, 51.841259], [5.860509, 51.842102], [5.858952, 51.84241]]],
};

function projectDetailsWorkVersion(overrides: Partial<ProjectDetailsWorkVersion> & { caseReference: string }): ProjectDetailsWorkVersion {
  return {
    readableProjectName: 'Nieuwbouwproject Dukenburg',
    projectDescription: 'Realisatie van 10 grondgebonden woningen in twee bouwfasen.',
    additionalInformation: '',
    projectWideNotes: 'Deze gegevens gelden voor het hele project.\nZonnepanelen achter de meter: ja\nAantal zonnepanelen: 40',
    housingLines: {},
    collectiveFacilityLines: {},
    kovaLines: {},
    createdAt: '2026-08-21T09:00:00.000Z',
    createdBy: 'woonbehoefte-project-details-worker',
    updatedAt: '2026-08-21T09:00:00.000Z',
    updatedBy: 'woonbehoefte-project-details-worker',
    ...overrides,
  };
}

// Overige gegevens zoals buildOtherDetails die daadwerkelijk zou opleveren: meerdere gelabelde regels, niet één losse zin.
const HOUSING_OTHER_DETAILS_VARIANTS = [
  'Verwarmingswijze: warmtenetLaagTemp',
  'Verwarmingswijze: individueleLuchtwarmtepomp\nGewenst vermogen afname (kW): 25',
  'Verwarmingswijze: centraleWarmtepomp\nGewenst vermogen afname (kW): 60\nGewenst vermogen teruglevering (kW): 10',
];

const FACILITY_OTHER_DETAILS_VARIANTS = [
  'Afname/teruglevering: afname\nTransportvermogen afname (kW): 45',
  'Afname/teruglevering: beide\nTransportvermogen afname (kW): 30\nTransportvermogen teruglevering (kW): 30',
  'Afname/teruglevering: afname\nTransportvermogen afname (kW): 12',
];

const KOVA_OTHER_DETAILS_VARIANTS = [
  'Verwarmingswijze: centraleWarmtepomp\nZonnepanelen achter de meter: ja\nAantal zonnepanelen: 24\nWattpiek per zonnepaneel: 350\n'
    + 'Laadpalen achter de meter: ja\nAantal laadpalen: 2\nPiekvermogen laadpalen (kW): 22\nTransportvermogen afname (kW): 40',
  'Verwarmingswijze: nogNietBekend\nZonnepanelen achter de meter: nogNietBekend\nLaadpalen achter de meter: nee\nTransportvermogen afname (kW): 18',
  'Verwarmingswijze: wko\nZonnepanelen achter de meter: nee\nLaadpalen achter de meter: ja\nAantal laadpalen: 1\n'
    + 'Piekvermogen laadpalen (kW): 11\nBeschrijving functie: Gemeenschappelijke ruimte met keuken en fietsenstalling',
];

function projectDetailsHousingLine(overrides: Partial<HousingLine> & { lineId: string; order: number }): HousingLine {
  const otherDetails = HOUSING_OTHER_DETAILS_VARIANTS[overrides.order % HOUSING_OTHER_DETAILS_VARIANTS.length];
  return { type: 'WOONHUIS', connectionCount: 10, connectionType: '3x25A', otherDetails, homesAccordingToForm: 10, ...overrides };
}

function projectDetailsFacilityLine(overrides: Partial<FacilityLine> & { lineId: string; order: number }): FacilityLine {
  const otherDetails = FACILITY_OTHER_DETAILS_VARIANTS[overrides.order % FACILITY_OTHER_DETAILS_VARIANTS.length];
  return { facilityType: 'collectieveWarmteKoudeVoorziening', connectionCount: 2, connectionType: '3x25A', otherDetails, ...overrides };
}

function projectDetailsKovaLine(overrides: Partial<KovaLine> & { lineId: string; order: number }): KovaLine {
  const otherDetails = KOVA_OTHER_DETAILS_VARIANTS[overrides.order % KOVA_OTHER_DETAILS_VARIANTS.length];
  return { function: 'Kinderopvang', connectionCount: 1, connectionType: '1x40A', otherDetails, ...overrides };
}

// Elke regel toont hier de vrije tekst die overblijft nadat de medewerker of aanvrager ooit 'anders' had
// gekozen en die had ingevuld: de werkversie bewaart alleen die tekst, geen apart 'anders'-veld meer.
const projectDetailsOnePerCategoryWorkVersion = projectDetailsWorkVersion({
  caseReference: 'OF-2026-00142',
  housingLines: {
    'wonen-1': projectDetailsHousingLine({ lineId: 'wonen-1', order: 0, connectionType: 'Tijdelijke aansluiting via de buren tijdens de verbouwing' }),
  },
  collectiveFacilityLines: {
    'voorz-1': projectDetailsFacilityLine({ lineId: 'voorz-1', order: 0, facilityType: 'Gedeelde fietsenstalling met oplaadpunten' }),
  },
  kovaLines: {
    'kova-1': projectDetailsKovaLine({ lineId: 'kova-1', order: 0, function: 'Buitenschoolse opvang in bijgebouw' }),
  },
});

// 6 wonen, 15 voorzieningen, 18 KOVA: het grootst realistisch gevulde dossier uit de gemeten voorbeelden (01-context-en-besluiten.md).
// Met een geldige bronlocatie, zodat deze preview ook toont dat de locatiekaart onder veel herhalende groepen bruikbaar blijft.
const projectDetailsManyLinesWorkVersion = projectDetailsWorkVersion({
  caseReference: 'OF-2026-00142',
  mijnAansluitingKenmerk: 'MA-2026-00142',
  sourceLocationPolygon: PREVIEW_SOURCE_POLYGON,
  housingLines: Object.fromEntries(Array.from({ length: 6 }, (_, index) => {
    const lineId = `wonen-${index + 1}`;
    return [lineId, projectDetailsHousingLine({
      lineId, order: index, type: index % 2 === 0 ? 'WOONHUIS' : 'APPARTEMENTEN', connectionCount: index + 1, homesAccordingToForm: index + 1,
    })];
  })),
  collectiveFacilityLines: Object.fromEntries(Array.from({ length: 15 }, (_, index) => {
    const lineId = `voorz-${index + 1}`;
    return [lineId, projectDetailsFacilityLine({ lineId, order: index, facilityType: `Voorziening ${index + 1}` })];
  })),
  kovaLines: Object.fromEntries(Array.from({ length: 18 }, (_, index) => {
    const lineId = `kova-${index + 1}`;
    return [lineId, projectDetailsKovaLine({ lineId, order: index, function: `Functie ${index + 1}` })];
  })),
});

const projectDetailsEmptyCategoryWorkVersion = projectDetailsWorkVersion({
  caseReference: 'OF-2026-00142',
  housingLines: { 'wonen-1': projectDetailsHousingLine({ lineId: 'wonen-1', order: 0 }) },
  collectiveFacilityLines: {},
  kovaLines: {},
});

function baseDetailData(canManage: boolean, actorEmail: string) {
  return buildWoonbehoefteDetailViewModel(
    detailCase, detailSource, 'READY', [], [], [], canManage, actorEmail, '', canManage ? 'preview-csrf-token' : undefined,
  );
}

export const woonbehoefteDetailProjectDetailsNew = {
  page: detailPage('OF-2026-00151'),
  data: {
    ...buildWoonbehoefteDetailViewModel(
      woonbehoefteCase({ caseReference: 'OF-2026-00151', status: 'NEW' }), source({ caseReference: 'OF-2026-00151', projectName: 'Nieuw dossier' }), 'READY',
      [], [], [], true, 'medewerker@example.invalid', '', 'preview-csrf-token',
    ),
    projectDetails: buildProjectDetailsViewModel('OF-2026-00151', undefined, undefined, true, 'preview-csrf-token', ''),
  },
};

export const woonbehoefteDetailProjectDetailsPending = {
  page: detailPage('OF-2026-00151'),
  data: {
    ...buildWoonbehoefteDetailViewModel(
      woonbehoefteCase({ caseReference: 'OF-2026-00151', status: 'NEW' }), source({ caseReference: 'OF-2026-00151', projectName: 'Nieuw dossier' }), 'READY',
      [], [], [], true, 'medewerker@example.invalid', '', 'preview-csrf-token',
    ),
    projectDetails: buildProjectDetailsViewModel(
      'OF-2026-00151', undefined, { caseReference: 'OF-2026-00151', status: 'PENDING', attemptedAt: '2026-08-21T09:00:00.000Z' },
      true, 'preview-csrf-token', '',
    ),
  },
};

export const woonbehoefteDetailProjectDetailsFailed = {
  page: detailPage('OF-2026-00151'),
  data: {
    ...buildWoonbehoefteDetailViewModel(
      woonbehoefteCase({ caseReference: 'OF-2026-00151', status: 'NEW' }), source({ caseReference: 'OF-2026-00151', projectName: 'Nieuw dossier' }), 'READY',
      [], [], [], true, 'medewerker@example.invalid', '', 'preview-csrf-token',
    ),
    projectDetails: buildProjectDetailsViewModel(
      'OF-2026-00151', undefined,
      { caseReference: 'OF-2026-00151', status: 'FAILED', attemptedAt: '2026-08-21T09:00:00.000Z', failureReasonCode: 'CSV_PARSE_ERROR' },
      true, 'preview-csrf-token', '',
    ),
  },
};

export const woonbehoefteDetailProjectDetailsReadyOnePerCategory = {
  page: detailPage('OF-2026-00142'),
  data: {
    ...baseDetailData(true, 'medewerker@example.invalid'),
    projectDetails: buildProjectDetailsViewModel('OF-2026-00142', projectDetailsOnePerCategoryWorkVersion, undefined, true, 'preview-csrf-token', ''),
  },
};

export const woonbehoefteDetailProjectDetailsReadyManyLines = {
  page: detailPage('OF-2026-00142'),
  data: {
    ...baseDetailData(true, 'medewerker@example.invalid'),
    projectDetails: buildProjectDetailsViewModel('OF-2026-00142', projectDetailsManyLinesWorkVersion, undefined, true, 'preview-csrf-token', ''),
  },
};

export const woonbehoefteDetailProjectDetailsReadyEmptyCategory = {
  page: detailPage('OF-2026-00142'),
  data: {
    ...baseDetailData(true, 'medewerker@example.invalid'),
    projectDetails: buildProjectDetailsViewModel('OF-2026-00142', projectDetailsEmptyCategoryWorkVersion, undefined, true, 'preview-csrf-token', ''),
  },
};

export const woonbehoefteDetailProjectDetailsReadOnly = {
  page: detailPage('OF-2026-00142'),
  data: {
    ...baseDetailData(false, 'kijker@example.invalid'),
    projectDetails: buildProjectDetailsViewModel('OF-2026-00142', projectDetailsOnePerCategoryWorkVersion, undefined, false, undefined, ''),
  },
};

const projectDetailsLocationSourceValidWorkVersion = projectDetailsWorkVersion({
  caseReference: 'OF-2026-00142',
  sourceLocationPolygon: PREVIEW_SOURCE_POLYGON,
});

const projectDetailsLocationSourceSelfIntersectingWorkVersion = projectDetailsWorkVersion({
  caseReference: 'OF-2026-00142',
  sourceLocationIssue: 'SELF_INTERSECTING',
});

const projectDetailsLocationManualCorrectedWorkVersion = projectDetailsWorkVersion({
  caseReference: 'OF-2026-00142',
  sourceLocationIssue: 'SELF_INTERSECTING',
  manualLocationPolygon: PREVIEW_MANUAL_POLYGON,
  manualLocationSetAt: '2026-09-20T14:32:00.000Z',
  manualLocationSetBy: 'medewerker@example.invalid',
});

export const woonbehoefteDetailProjectDetailsLocationSourceValid = {
  page: detailPage('OF-2026-00142'),
  data: {
    ...baseDetailData(true, 'medewerker@example.invalid'),
    projectDetails: buildProjectDetailsViewModel('OF-2026-00142', projectDetailsLocationSourceValidWorkVersion, undefined, true, 'preview-csrf-token', ''),
  },
};

// Geen bronlocatie ingevuld en geen handmatige correctie: dezelfde werkversie als de "één per categorie"-preview.
export const woonbehoefteDetailProjectDetailsLocationMissing = {
  page: detailPage('OF-2026-00142'),
  data: {
    ...baseDetailData(true, 'medewerker@example.invalid'),
    projectDetails: buildProjectDetailsViewModel('OF-2026-00142', projectDetailsOnePerCategoryWorkVersion, undefined, true, 'preview-csrf-token', ''),
  },
};

export const woonbehoefteDetailProjectDetailsLocationSelfIntersecting = {
  page: detailPage('OF-2026-00142'),
  data: {
    ...baseDetailData(true, 'medewerker@example.invalid'),
    projectDetails: buildProjectDetailsViewModel(
      'OF-2026-00142', projectDetailsLocationSourceSelfIntersectingWorkVersion, undefined, true, 'preview-csrf-token', '',
    ),
  },
};

export const woonbehoefteDetailProjectDetailsLocationManualCorrected = {
  page: detailPage('OF-2026-00142'),
  data: {
    ...baseDetailData(true, 'medewerker@example.invalid'),
    projectDetails: buildProjectDetailsViewModel(
      'OF-2026-00142', projectDetailsLocationManualCorrectedWorkVersion, undefined, true, 'preview-csrf-token', '',
    ),
  },
};

export const woonbehoefteDetailProjectDetailsLocationReadOnly = {
  page: detailPage('OF-2026-00142'),
  data: {
    ...baseDetailData(false, 'kijker@example.invalid'),
    projectDetails: buildProjectDetailsViewModel('OF-2026-00142', projectDetailsLocationSourceValidWorkVersion, undefined, false, undefined, ''),
  },
};
