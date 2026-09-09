import { WoonbehoefteCase } from '../../../domain/WoonbehoefteCase';
import { WoonbehoefteSourceRecord } from '../../../domain/WoonbehoefteSource';
import { WoonbehoefteCaseWithSource } from '../../../overview/WoonbehoefteOverviewViewModel';
import { buildWoonbehoefteReportRows } from '../buildWoonbehoefteReportRows';

function woonbehoefteCase(overrides: Partial<WoonbehoefteCase> & { caseReference: string }): WoonbehoefteCase {
  return {
    status: 'NEW',
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

function source(overrides: Partial<WoonbehoefteSourceRecord> & { caseReference: string }): WoonbehoefteSourceRecord {
  return {
    status: 'READY',
    cacheVersion: 1,
    objectUuid: `uuid-${overrides.caseReference}`,
    submissionId: `uuid-${overrides.caseReference}`,
    submissionType: 'PRIMARY_APPLICATION',
    reference: overrides.caseReference,
    formName: 'Aanmelden stroomaansluiting woningbouw',
    registrationAt: '2026-08-20T10:15:00.000Z',
    applicantType: 'INDIVIDUAL',
    attachments: [],
    cachedAt: '2026-08-20T10:15:00.000Z',
    ...overrides,
  };
}

describe('buildWoonbehoefteReportRows', () => {
  it('maps a fully assessed case with a matching source into a complete row', () => {
    const entry: WoonbehoefteCaseWithSource = {
      woonbehoefteCase: woonbehoefteCase({
        caseReference: 'OF-1',
        status: 'IN_PROGRESS',
        claimedBy: 'medewerker@nijmegen.nl',
        claimedAt: '2026-08-05T09:00:00.000Z',
        assessment: {
          assessedStartPeriod: 202803,
          assessedProjectReadiness: 1,
          applicationComplete: 'YES',
        },
        check: { requested: true, requestedAt: '2026-08-06T09:00:00.000Z', requestedBy: 'medewerker@nijmegen.nl' },
        ranking: { period: 202803, rank: 4, lottery: false },
      }),
      source: source({
        caseReference: 'OF-1',
        projectName: 'Project Een',
        contactName: 'Jan Jansen',
        submittedProjectReadiness: 5,
        totalHomes: 40,
        isCollectiveHousing: true,
      }),
    };

    const [row] = buildWoonbehoefteReportRows([entry]);

    expect(row.caseReference).toBe('OF-1');
    expect(row.projectName).toBe('Project Een');
    expect(row.statusLabel).toBe('In behandeling');
    expect(row.assessedStartYear).toBe(2028);
    expect(row.assessedStartMonth).toBe(3);
    expect(row.assigneeLabel).toBe('medewerker@nijmegen.nl');
    expect(row.applicationCompleteLabel).toBe('Ja');
    expect(row.checkRequestedLabel).toBe('Ja');
    expect(row.ranking).toBe(4);
    expect(row.lotteryLabel).toBe('Nee');
    expect(row.contactName).toBe('Jan Jansen');
    expect(row.totalHomes).toBe(40);
    expect(row.collectiveHousingLabel).toBe('Ja');
    expect(row.sourceWarning).toBe('');
  });

  it('keeps assessed (vastgesteld) and submitted (ingediend) project readiness clearly separate', () => {
    const entry: WoonbehoefteCaseWithSource = {
      woonbehoefteCase: woonbehoefteCase({ caseReference: 'OF-2', assessment: { assessedProjectReadiness: 1 } }),
      source: source({ caseReference: 'OF-2', submittedProjectReadiness: 5 }),
    };

    const [row] = buildWoonbehoefteReportRows([entry]);

    expect(row.assessedProjectReadinessCategory).toBe(1);
    expect(row.submittedProjectReadinessCategory).toBe(5);
    expect(row.assessedProjectReadinessLabel).not.toBe(row.submittedProjectReadinessLabel);
  });

  it('leaves unassessed fields as their own distinct label, not confused with an explicit NO', () => {
    const entry: WoonbehoefteCaseWithSource = {
      woonbehoefteCase: woonbehoefteCase({ caseReference: 'OF-3' }),
      source: source({ caseReference: 'OF-3' }),
    };

    const [row] = buildWoonbehoefteReportRows([entry]);

    expect(row.applicationCompleteLabel).toBe('Nog niet beoordeeld');
  });

  it('flags a missing source with a Bronwaarschuwing and leaves source-derived fields empty', () => {
    const entry: WoonbehoefteCaseWithSource = { woonbehoefteCase: woonbehoefteCase({ caseReference: 'OF-4' }), source: undefined };

    const [row] = buildWoonbehoefteReportRows([entry]);

    expect(row.sourceWarning).toContain('bronconflict');
    expect(row.projectName).toBe('');
    expect(row.contactName).toBe('');
  });

  it('flags a source conflict with the same Bronwaarschuwing, even though the case itself is still exported', () => {
    const entry: WoonbehoefteCaseWithSource = {
      woonbehoefteCase: woonbehoefteCase({ caseReference: 'OF-5' }), source: undefined, hasSourceConflict: true,
    };

    const [row] = buildWoonbehoefteReportRows([entry]);

    expect(row.caseReference).toBe('OF-5');
    expect(row.sourceWarning).toContain('bronconflict');
  });

  it('never logs raw CSV content: submittedStartDate is passed through as-is, not reformatted', () => {
    const entry: WoonbehoefteCaseWithSource = {
      woonbehoefteCase: woonbehoefteCase({ caseReference: 'OF-6' }),
      source: source({ caseReference: 'OF-6', submittedStartDate: '01-03-2028' }),
    };

    const [row] = buildWoonbehoefteReportRows([entry]);

    expect(row.submittedStartDate).toBe('01-03-2028');
  });

  it('attaches the raw form fields for a case when a successful fetch outcome is given', () => {
    const entry: WoonbehoefteCaseWithSource = {
      woonbehoefteCase: woonbehoefteCase({ caseReference: 'OF-7' }),
      source: source({ caseReference: 'OF-7' }),
    };
    const rawFormFields = new Map([['OF-7', { fields: { headers: ['projectNaam'], values: { projectNaam: 'Project Rivierzicht' } } }]]);

    const [row] = buildWoonbehoefteReportRows([entry], rawFormFields);

    expect(row.rawFormFields?.values.projectNaam).toBe('Project Rivierzicht');
    expect(row.sourceWarning).toBe('');
  });

  it('appends a raw form field fetch warning on its own line, alongside an existing Bronwaarschuwing', () => {
    const entry: WoonbehoefteCaseWithSource = { woonbehoefteCase: woonbehoefteCase({ caseReference: 'OF-8' }), source: undefined };
    const rawFormFields = new Map([['OF-8', { warning: 'Originele formulierdata kon niet worden geladen.' }]]);

    const [row] = buildWoonbehoefteReportRows([entry], rawFormFields);

    expect(row.rawFormFields).toBeUndefined();
    expect(row.sourceWarning.split('\n')).toHaveLength(2);
    expect(row.sourceWarning).toContain('bronconflict');
    expect(row.sourceWarning).toContain('formulierdata kon niet worden geladen');
  });

  it('leaves rawFormFields undefined and no extra warning when the option was off (empty map)', () => {
    const entry: WoonbehoefteCaseWithSource = {
      woonbehoefteCase: woonbehoefteCase({ caseReference: 'OF-9' }),
      source: source({ caseReference: 'OF-9' }),
    };

    const [row] = buildWoonbehoefteReportRows([entry]);

    expect(row.rawFormFields).toBeUndefined();
    expect(row.sourceWarning).toBe('');
  });

  it('attaches the attachment filenames text for a case when an outcome is given', () => {
    const entry: WoonbehoefteCaseWithSource = {
      woonbehoefteCase: woonbehoefteCase({ caseReference: 'OF-10' }),
      source: source({ caseReference: 'OF-10' }),
    };
    const attachmentFilenames = new Map([['OF-10', { filenamesText: 'bijlage-een.pdf\nbijlage-twee.pdf' }]]);

    const [row] = buildWoonbehoefteReportRows([entry], undefined, attachmentFilenames);

    expect(row.attachmentFilenamesText).toBe('bijlage-een.pdf\nbijlage-twee.pdf');
    expect(row.sourceWarning).toBe('');
  });

  it('appends an attachment filenames warning on its own line, alongside an existing Bronwaarschuwing', () => {
    const entry: WoonbehoefteCaseWithSource = { woonbehoefteCase: woonbehoefteCase({ caseReference: 'OF-11' }), source: undefined };
    const attachmentFilenames = new Map([['OF-11', { filenamesText: '', warning: 'Bestandsnaam van 1 bijlage kon niet worden geladen.' }]]);

    const [row] = buildWoonbehoefteReportRows([entry], undefined, attachmentFilenames);

    expect(row.sourceWarning.split('\n')).toHaveLength(2);
    expect(row.sourceWarning).toContain('bronconflict');
    expect(row.sourceWarning).toContain('bijlage kon niet worden geladen');
  });

  it('leaves attachmentFilenamesText empty and no extra warning when the option was off (empty map)', () => {
    const entry: WoonbehoefteCaseWithSource = {
      woonbehoefteCase: woonbehoefteCase({ caseReference: 'OF-12' }),
      source: source({ caseReference: 'OF-12' }),
    };

    const [row] = buildWoonbehoefteReportRows([entry]);

    expect(row.attachmentFilenamesText).toBe('');
    expect(row.sourceWarning).toBe('');
  });
});
