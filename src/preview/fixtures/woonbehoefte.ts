import { buildWoonbehoefteDetailViewModel } from '../../app/woonbehoefte/detail/WoonbehoefteDetailViewModel';
import { WoonbehoefteDocumentRow } from '../../app/woonbehoefte/documents/WoonbehoefteDocumentsLoader';
import { CaseActivity, CaseNote, WoonbehoefteCase } from '../../app/woonbehoefte/domain/WoonbehoefteCase';
import { WoonbehoefteSourceRecord } from '../../app/woonbehoefte/domain/WoonbehoefteSource';
import { resolveWoonbehoefteOverviewFilter } from '../../app/woonbehoefte/overview/WoonbehoefteOverviewFilter';
import { buildWoonbehoefteOverviewViewModel, joinCasesWithSources } from '../../app/woonbehoefte/overview/WoonbehoefteOverviewViewModel';
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
    isRefreshing: false,
    refreshStarted: false,
    refreshAlreadyRunning: false,
  },
};

export const woonbehoefteAdditionalEvidenceOverview = {
  page: { ...woonbehoeftePage('medewerker@example.invalid'), title: 'Woonbehoefte - Extra bewijzen' },
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

export const woonbehoefteDetailInadmissible = {
  page: detailPage('OF-2026-00033'),
  data: buildWoonbehoefteDetailViewModel(
    woonbehoefteCase({ caseReference: 'OF-2026-00033', status: 'INADMISSIBLE', claimedBy: 'medewerker@example.invalid' }),
    source({ caseReference: 'OF-2026-00033', projectName: 'Aanvraag zonder rechtsgeldige onderbouwing', applicantType: 'PROJECT_APPLICANT' }),
    'READY', [], [], [], true, 'medewerker@example.invalid', '', 'preview-csrf-token',
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
