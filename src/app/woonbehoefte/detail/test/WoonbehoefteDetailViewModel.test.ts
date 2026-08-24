import { WoonbehoefteCase } from '../../domain/WoonbehoefteCase';
import { WoonbehoefteSourceRecord } from '../../domain/WoonbehoefteSource';
import { buildWoonbehoefteDetailViewModel } from '../WoonbehoefteDetailViewModel';

function makeCase(overrides: Partial<WoonbehoefteCase> = {}): WoonbehoefteCase {
  return {
    caseReference: 'OF-1',
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

function makeSource(overrides: Partial<WoonbehoefteSourceRecord> = {}): WoonbehoefteSourceRecord {
  return {
    status: 'READY',
    cacheVersion: 1,
    objectUuid: 'uuid-1',
    submissionId: 'uuid-1',
    submissionType: 'PRIMARY_APPLICATION',
    reference: 'OF-1',
    caseReference: 'OF-1',
    formName: 'Aanmelden stroomaansluiting woningbouw',
    registrationAt: '2026-08-01T10:00:00.000Z',
    applicantType: 'UNKNOWN',
    attachments: [],
    cachedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function build(woonbehoefteCase: WoonbehoefteCase, source: WoonbehoefteSourceRecord | undefined, availability: 'READY' | 'FAILED' | 'MISSING') {
  return buildWoonbehoefteDetailViewModel(woonbehoefteCase, source, availability, [], [], [], true, 'medewerker@example.nl', '', 'csrf-token');
}

describe('buildWoonbehoefteDetailViewModel', () => {
  it('never overwrites the submitted value with the assessed one: both are shown separately', () => {
    const woonbehoefteCase = makeCase({ assessment: { assessedStartPeriod: 202809 } });
    const viewModel = build(woonbehoefteCase, makeSource({ submittedStartDate: '2028-08-30' }), 'READY');

    expect(viewModel.submittedStartDateLabel).toBe('30 augustus 2028');
    expect(viewModel.assessedStartPeriodLabel).toBe('september 2028');
  });

  it('shows a clear message and no crash when the projectrijpheid could not be determined from the source', () => {
    const viewModel = build(makeCase(), makeSource({ submittedProjectReadiness: undefined }), 'READY');

    expect(viewModel.submittedReadinessLabel).toBe('Kon niet eenduidig worden vastgesteld');
    expect(viewModel.assessedReadinessLabel).toBe('Nog niet vastgesteld');
  });

  it('shows a source error message and a fallback project name when the source failed or is missing', () => {
    const failed = build(makeCase(), undefined, 'FAILED');
    expect(failed.hasSource).toBe(false);
    expect(failed.sourceErrorMessage).toBeDefined();
    expect(failed.projectName).toContain('bron nog niet beschikbaar');

    const missing = build(makeCase(), undefined, 'MISSING');
    expect(missing.hasSource).toBe(false);
    expect(missing.sourceErrorMessage).toBeDefined();
  });

  it('offers claim/release/takeover based on who currently holds the claim, only when the actor can manage', () => {
    const unclaimed = build(makeCase(), makeSource(), 'READY');
    expect(unclaimed.canClaim).toBe(true);
    expect(unclaimed.canRelease).toBe(false);
    expect(unclaimed.canTakeOver).toBe(false);

    const claimedByMe = build(makeCase({ claimedBy: 'medewerker@example.nl' }), makeSource(), 'READY');
    expect(claimedByMe.canClaim).toBe(false);
    expect(claimedByMe.canRelease).toBe(true);
    expect(claimedByMe.canTakeOver).toBe(false);

    const claimedByOther = build(makeCase({ claimedBy: 'ander@example.nl' }), makeSource(), 'READY');
    expect(claimedByOther.canClaim).toBe(false);
    expect(claimedByOther.canRelease).toBe(false);
    expect(claimedByOther.canTakeOver).toBe(true);

    const viewOnly = buildWoonbehoefteDetailViewModel(makeCase(), makeSource(), 'READY', [], [], [], false, 'medewerker@example.nl', '');
    expect(viewOnly.canClaim).toBe(false);
  });

  it('excludes both PROPOSED_INADMISSIBLE and INADMISSIBLE from the regular status options: each needs its own dedicated action', () => {
    const values = build(makeCase(), makeSource(), 'READY').statusOptions.map((o) => o.value);

    expect(values).not.toContain('PROPOSED_INADMISSIBLE');
    expect(values).not.toContain('INADMISSIBLE');
    expect(values).toEqual(['NEW', 'IN_PROGRESS', 'WAITING_FOR_ADDITIONAL_INFORMATION', 'READY_FOR_RANKING']);
  });

  it('never lets the generic status select default to the wrong status when the current one is not in its option list', () => {
    const proposed = build(makeCase({ status: 'PROPOSED_INADMISSIBLE' }), makeSource(), 'READY');
    expect(proposed.canUseGenericStatusSelect).toBe(false);
    expect(proposed.isProposedInadmissible).toBe(true);
    expect(proposed.isInadmissible).toBe(false);

    const inadmissible = build(makeCase({ status: 'INADMISSIBLE' }), makeSource(), 'READY');
    expect(inadmissible.canUseGenericStatusSelect).toBe(false);
    expect(inadmissible.isInadmissible).toBe(true);
    expect(inadmissible.isProposedInadmissible).toBe(false);

    const inProgress = build(makeCase({ status: 'IN_PROGRESS' }), makeSource(), 'READY');
    expect(inProgress.canUseGenericStatusSelect).toBe(true);
  });

  it('every ternary assessment select starts with an explicit "Nog niet beoordeeld" option, never defaulting to Ja', () => {
    const viewModel = build(makeCase(), makeSource(), 'READY');

    expect(viewModel.applicationCompleteOptions[0]).toMatchObject({ value: '', selected: true });
    expect(viewModel.applicationCompleteOptions.some((o) => o.value === 'YES' && o.selected)).toBe(false);
  });

  it('a previously stored assessed year outside the default bracket is still offered as a select option', () => {
    const viewModel = build(makeCase({ assessment: { assessedStartPeriod: 205012 } }), makeSource(), 'READY');

    expect(viewModel.assessedStartYearOptions.some((o) => o.value === '2050' && o.selected)).toBe(true);
  });

  it('sorts notes and activities newest first', () => {
    const viewModel = buildWoonbehoefteDetailViewModel(
      makeCase(), makeSource(), 'READY', [],
      [
        { noteId: 'n1', caseReference: 'OF-1', category: 'GENERAL', text: 'oud', createdAt: '2026-08-01T00:00:00.000Z', createdBy: 'a@example.nl' },
        { noteId: 'n2', caseReference: 'OF-1', category: 'GENERAL', text: 'nieuw', createdAt: '2026-08-02T00:00:00.000Z', createdBy: 'a@example.nl' },
      ],
      [
        { activityId: 'a1', caseReference: 'OF-1', type: 'CASE_CREATED', actor: 'worker', occurredAt: '2026-08-01T00:00:00.000Z', summary: 'oud' },
        { activityId: 'a2', caseReference: 'OF-1', type: 'CASE_CLAIMED', actor: 'worker', occurredAt: '2026-08-02T00:00:00.000Z', summary: 'nieuw' },
      ],
      true, 'medewerker@example.nl', '', 'csrf-token',
    );

    expect(viewModel.notes.map((n) => n.text)).toEqual(['nieuw', 'oud']);
    expect(viewModel.activities.map((a) => a.summary)).toEqual(['nieuw', 'oud']);
  });

  it('formats activity change lines in Dutch, never leaking raw English enum values', () => {
    const viewModel = buildWoonbehoefteDetailViewModel(
      makeCase(), makeSource(), 'READY', [], [],
      [
        {
          activityId: 'a1',
          caseReference: 'OF-1',
          type: 'STATUS_CHANGED',
          actor: 'medewerker@example.nl',
          occurredAt: '2026-08-01T00:00:00.000Z',
          summary: 'Status gewijzigd',
          changes: [{ field: 'status', from: 'IN_PROGRESS', to: 'WAITING_FOR_ADDITIONAL_INFORMATION' }],
        },
        {
          activityId: 'a2',
          caseReference: 'OF-1',
          type: 'ASSESSMENT_UPDATED',
          actor: 'medewerker@example.nl',
          occurredAt: '2026-08-02T00:00:00.000Z',
          summary: 'Beoordeling bijgewerkt',
          changes: [{ field: 'assessment.applicationComplete', from: 'YES', to: 'NO' }],
        },
        {
          activityId: 'a3',
          caseReference: 'OF-1',
          type: 'CHECK_COMPLETED',
          actor: 'medewerker@example.nl',
          occurredAt: '2026-08-03T00:00:00.000Z',
          summary: 'Check afgerond',
          changes: [{ field: 'check.lastOutcome', to: 'CHANGES_NEEDED' }],
        },
      ],
      true, 'medewerker@example.nl', '', 'csrf-token',
    );

    const [checkLine, assessmentLine, statusLine] = viewModel.activities.map((a) => a.changeLines[0]);
    expect(statusLine).toBe('Status: In behandeling -> Wacht op aanvullende informatie');
    expect(assessmentLine).toBe('Aanvraagformulier volledig: Ja -> Nee');
    expect(checkLine).toBe('Check: Aanpassing gewenst');
    for (const line of [statusLine, assessmentLine, checkLine]) {
      expect(line).not.toMatch(/[A-Z]{2,}_[A-Z]+/);
    }
  });
});
