import { ProjectDetailsWorkVersion } from '../domain/ProjectDetails';
import { buildProjectDetailsViewModel, buildUnavailableProjectDetailsViewModel } from '../ui/ProjectDetailsViewModel';

function workVersion(overrides: Partial<ProjectDetailsWorkVersion> = {}): ProjectDetailsWorkVersion {
  return {
    caseReference: 'OF-1',
    readableProjectName: 'Voorbeeldproject',
    projectDescription: 'Beschrijving',
    additionalInformation: '',
    projectWideNotes: 'Deze gegevens gelden voor het hele project.',
    housingLines: {},
    collectiveFacilityLines: {},
    kovaLines: {},
    createdAt: '2026-09-25T10:00:00.000Z',
    createdBy: 'worker',
    updatedAt: '2026-09-25T10:00:00.000Z',
    updatedBy: 'worker',
    ...overrides,
  };
}

describe('buildProjectDetailsViewModel', () => {
  it('is NEW without a werkversie or pogingstatus', () => {
    const vm = buildProjectDetailsViewModel('OF-1', undefined, undefined, true, 'token', '');
    expect(vm).toMatchObject({ status: 'NEW', isNew: true, isPending: false, isReady: false, isFailed: false });
  });

  it('is PENDING while a poging loopt en er nog geen werkversie is', () => {
    const vm = buildProjectDetailsViewModel(
      'OF-1', undefined, { caseReference: 'OF-1', status: 'PENDING', attemptedAt: '2026-09-25T10:00:00.000Z' }, true, 'token', '',
      new Date('2026-09-25T10:05:00.000Z'),
    );
    expect(vm).toMatchObject({ status: 'PENDING', isPending: true });
  });

  it('treats a PENDING poging older than the Lambda-timeout as FAILED, so a crashed worker can be retried', () => {
    const vm = buildProjectDetailsViewModel(
      'OF-1', undefined, { caseReference: 'OF-1', status: 'PENDING', attemptedAt: '2026-09-25T10:00:00.000Z' }, true, 'token', '',
      new Date('2026-09-25T10:30:00.000Z'),
    );
    expect(vm).toMatchObject({ status: 'FAILED', isFailed: true });
  });

  it('is FAILED with the failure reason exposed, but never CSV content', () => {
    const vm = buildProjectDetailsViewModel(
      'OF-1', undefined, { caseReference: 'OF-1', status: 'FAILED', attemptedAt: '2026-09-25T10:00:00.000Z', failureReasonCode: 'CSV_PARSE_ERROR' },
      true, 'token', '',
    );
    expect(vm).toMatchObject({ status: 'FAILED', isFailed: true, failureReasonCode: 'CSV_PARSE_ERROR' });
  });

  it('is READY when a werkversie exists, even with a stale FAILED pogingstatus lingering', () => {
    const vm = buildProjectDetailsViewModel(
      'OF-1', workVersion(), { caseReference: 'OF-1', status: 'FAILED', attemptedAt: '2026-09-25T09:00:00.000Z' }, true, 'token', '',
    );
    expect(vm).toMatchObject({ status: 'READY', isReady: true });
    expect(vm.failureReasonCode).toBeUndefined();
  });

  it('composes the full project name from the OF-kenmerk and the readable name, never the original projectName', () => {
    const vm = buildProjectDetailsViewModel('OF-2026-042', workVersion({ readableProjectName: 'Park Fluvium' }), undefined, true, 'token', '');
    expect(vm.fullProjectName).toBe('OF-2026-042 - Park Fluvium');
  });

  it('orders line cards by their stored order and numbers them 1-based for display', () => {
    const vm = buildProjectDetailsViewModel('OF-1', workVersion({
      housingLines: {
        b: { lineId: 'b', order: 1, type: 'WOONHUIS', connectionCount: 2, connectionType: '3x25A', otherDetails: '' },
        a: { lineId: 'a', order: 0, type: 'APPARTEMENTEN', connectionCount: 4, connectionType: '3x40A', otherDetails: '' },
      },
    }), undefined, true, 'token', '');

    expect(vm.housingLines.map((line) => line.lineId)).toEqual(['a', 'b']);
    expect(vm.housingLines.map((line) => line.number)).toEqual([1, 2]);
    expect(vm.hasHousingLines).toBe(true);
    expect(vm.hasFacilityLines).toBe(false);
  });

  it('marks the current type as selected among the four housing type options', () => {
    const vm = buildProjectDetailsViewModel('OF-1', workVersion({
      housingLines: { a: { lineId: 'a', order: 0, type: 'COLLECTIEF_WONEN', connectionCount: 1, connectionType: '', otherDetails: '' } },
    }), undefined, true, 'token', '');

    const selected = vm.housingLines[0].typeOptions?.filter((option) => option.selected);
    expect(selected).toEqual([{ value: 'COLLECTIEF_WONEN', label: 'Collectief wonen', selected: true }]);
  });

  it('omits csrfToken and project fields for a view-only medewerker without a werkversie', () => {
    const vm = buildProjectDetailsViewModel('OF-1', undefined, undefined, false, undefined, '');
    expect(vm.csrfToken).toBeUndefined();
    expect(vm.canManage).toBe(false);
  });

  it('marks the section as isUnavailable, with every other status flag off, when its own read fails', () => {
    const vm = buildUnavailableProjectDetailsViewModel('OF-1', true, 'token', '');
    expect(vm).toMatchObject({
      isUnavailable: true, isNew: false, isPending: false, isReady: false, isFailed: false, hasHousingLines: false,
    });
  });
});
