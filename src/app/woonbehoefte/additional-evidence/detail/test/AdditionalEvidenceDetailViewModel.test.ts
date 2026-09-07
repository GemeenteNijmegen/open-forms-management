import { WoonbehoefteCase } from '../../../domain/WoonbehoefteCase';
import { WoonbehoefteSourceRecord } from '../../../domain/WoonbehoefteSource';
import { ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION, AdditionalEvidenceSourceRecord } from '../../domain/AdditionalEvidenceSource';
import { AdditionalEvidenceWorkItem } from '../../persistence/AdditionalEvidenceRepository';
import { buildAdditionalEvidenceCaseLookup, buildAdditionalEvidenceDetailViewModel } from '../AdditionalEvidenceDetailViewModel';

function woonbehoefteCase(overrides: Partial<WoonbehoefteCase> = {}): WoonbehoefteCase {
  return {
    caseReference: 'OF-HOOFD01',
    status: 'IN_PROGRESS',
    statusChangedAt: '2026-08-01T00:00:00.000Z',
    assessment: {},
    check: { requested: false },
    version: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    createdBy: 'woonbehoefte-sync-worker',
    updatedAt: '2026-08-01T00:00:00.000Z',
    updatedBy: 'woonbehoefte-sync-worker',
    ...overrides,
  };
}

function primarySource(overrides: Partial<WoonbehoefteSourceRecord> = {}): WoonbehoefteSourceRecord {
  return {
    status: 'READY',
    cacheVersion: 1,
    objectUuid: 'uuid-primary-1',
    submissionId: 'uuid-primary-1',
    submissionType: 'PRIMARY_APPLICATION',
    reference: 'OF-HOOFD01',
    caseReference: 'OF-HOOFD01',
    formName: 'Aanmelden stroomaansluiting woningbouw',
    registrationAt: '2026-08-01T00:00:00.000Z',
    applicantType: 'UNKNOWN',
    attachments: [],
    cachedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function workItem(overrides: Partial<AdditionalEvidenceWorkItem> = {}): AdditionalEvidenceWorkItem {
  return {
    objectUuid: 'uuid-1',
    submissionReference: 'OF-EXTRA01',
    status: 'NEW',
    createdAt: '2026-09-07T18:00:00.000Z',
    createdBy: 'additional-evidence-sync-worker',
    ...overrides,
  };
}

function source(overrides: Partial<AdditionalEvidenceSourceRecord> = {}): AdditionalEvidenceSourceRecord {
  return {
    status: 'READY',
    cacheVersion: ADDITIONAL_EVIDENCE_SOURCE_CACHE_VERSION,
    objectUuid: 'uuid-1',
    submissionId: 'uuid-1',
    reference: 'OF-EXTRA01',
    formName: 'Extra bewijzen stroomaansluiting woningbouw',
    submittedAt: '2026-09-07T17:54:04.702Z',
    originalCaseReference: 'OF-HOOFD01',
    attachments: [],
    cachedAt: '2026-09-07T18:00:00.000Z',
    ...overrides,
  };
}

describe('buildAdditionalEvidenceDetailViewModel', () => {
  it('defaults the search kenmerk to origineleKenmerk, keeping it visually distinct from the own submission reference', () => {
    const viewModel = buildAdditionalEvidenceDetailViewModel(workItem(), source({ originalCaseReference: 'OF-HOOFD99' }), 'READY', [], '');

    expect(viewModel.submissionReference).toBe('OF-EXTRA01');
    expect(viewModel.originalCaseReferenceLabel).toBe('OF-HOOFD99');
    expect(viewModel.searchCaseReferenceValue).toBe('OF-HOOFD99');
  });

  it('shows a technical bronfout, not a workflow status, when the source failed', () => {
    const viewModel = buildAdditionalEvidenceDetailViewModel(workItem(), undefined, 'FAILED', [], '');

    expect(viewModel.hasSourceError).toBe(true);
    expect(viewModel.sourceErrorMessage).toContain('konden niet volledig worden gelezen');
    expect(viewModel.statusLabel).toBe('Nieuw');
    expect(viewModel.projectNameLabel).toBe('Onbekend project (bron nog niet beschikbaar)');
  });

  it('splits the application PDF from attachments', () => {
    const documents = [
      { documentId: 'pdf-1', filenameLabel: 'form.pdf', downloadHref: '/x', isApplicationPdf: true },
      { documentId: 'att-1', filenameLabel: 'bijlage.pdf', downloadHref: '/y', isApplicationPdf: false },
    ];

    const viewModel = buildAdditionalEvidenceDetailViewModel(workItem(), source(), 'READY', documents, '');

    expect(viewModel.applicationDocument?.documentId).toBe('pdf-1');
    expect(viewModel.attachments.map((a) => a.documentId)).toEqual(['att-1']);
    expect(viewModel.hasAttachments).toBe(true);
  });

  it('carries the objectUuid separately as submissionId, distinct from the medewerker-facing submissionReference', () => {
    const viewModel = buildAdditionalEvidenceDetailViewModel(workItem({ objectUuid: 'uuid-abc', submissionReference: 'OF-EXTRA09' }), source(), 'READY', [], '');

    expect(viewModel.submissionId).toBe('uuid-abc');
    expect(viewModel.submissionReference).toBe('OF-EXTRA09');
  });

  it('shows the just-searched kenmerk in the zoekveld, not the original one, once a search happened', () => {
    const caseLookup = buildAdditionalEvidenceCaseLookup('OF-ANDERS02', woonbehoefteCase({ caseReference: 'OF-ANDERS02' }), primarySource(), true);

    const viewModel = buildAdditionalEvidenceDetailViewModel(
      workItem(), source({ originalCaseReference: 'OF-HOOFD01' }), 'READY', [], '', undefined, caseLookup,
    );

    expect(viewModel.searchCaseReferenceValue).toBe('OF-ANDERS02');
    expect(viewModel.originalCaseReferenceLabel).toBe('OF-HOOFD01');
  });
});

describe('buildAdditionalEvidenceCaseLookup', () => {
  it('shows the hoofdzaak project name distinctly labelled from the additional evidence projectnaam, never confused', () => {
    const caseLookup = buildAdditionalEvidenceCaseLookup(
      'OF-HOOFD01', woonbehoefteCase(), primarySource({ projectName: 'Project Lindenhof fase 2' }), true,
    );

    expect(caseLookup.found).toBe(true);
    expect(caseLookup.hoofdzaakProjectNameLabel).toBe('Project Lindenhof fase 2');
    expect(caseLookup.hoofdzaakSourceMissing).toBe(false);
  });

  it('does not block on a missing primary source, but flags it', () => {
    const caseLookup = buildAdditionalEvidenceCaseLookup('OF-HOOFD01', woonbehoefteCase(), undefined, false);

    expect(caseLookup.found).toBe(true);
    expect(caseLookup.hoofdzaakSourceMissing).toBe(true);
    expect(caseLookup.hoofdzaakStatusLabel).toBe('In behandeling');
  });

  it('reports not found without ever creating anything, keeping the searched value for the medewerker to correct', () => {
    const caseLookup = buildAdditionalEvidenceCaseLookup('OF-ONBEKEND99', undefined, undefined, false);

    expect(caseLookup.found).toBe(false);
    expect(caseLookup.searchedReference).toBe('OF-ONBEKEND99');
  });
});
