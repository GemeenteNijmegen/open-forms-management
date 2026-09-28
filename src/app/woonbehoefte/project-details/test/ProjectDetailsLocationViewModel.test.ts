import { ProjectDetailsWorkVersion } from '../domain/ProjectDetails';
import { buildProjectDetailsLocationViewModel } from '../ui/ProjectDetailsLocationViewModel';

const POLYGON = { type: 'Polygon' as const, coordinates: [[[5.86, 51.85], [5.87, 51.85], [5.87, 51.86], [5.86, 51.85]]] };

function workVersion(overrides: Partial<ProjectDetailsWorkVersion> = {}): ProjectDetailsWorkVersion {
  return {
    caseReference: 'OF-1',
    readableProjectName: 'Voorbeeldproject',
    projectDescription: '',
    additionalInformation: '',
    projectWideNotes: '',
    housingLines: {},
    collectiveFacilityLines: {},
    kovaLines: {},
    createdAt: '',
    createdBy: '',
    updatedAt: '',
    updatedBy: '',
    ...overrides,
  };
}

describe('buildProjectDetailsLocationViewModel', () => {
  it('is bron geldig when a sourceLocationPolygon exists and there is no manuele locatie', () => {
    const vm = buildProjectDetailsLocationViewModel(workVersion({ sourceLocationPolygon: POLYGON }), undefined);
    expect(vm).toMatchObject({
      isLocationManual: false,
      isLocationBronValid: true,
      isLocationBronMissing: false,
      isLocationBronUnusablePrimary: false,
      locationCanDownload: true,
    });
  });

  it('is bron ontbreekt when there is no polygon and no reden-code at all (bijvoorbeeld een handmatig leeg gestarte werkversie)', () => {
    const vm = buildProjectDetailsLocationViewModel(workVersion(), undefined);
    expect(vm).toMatchObject({
      isLocationBronMissing: true, isLocationBronValid: false, isLocationBronUnusablePrimary: false, locationCanDownload: false,
    });
  });

  it('is bron ontbreekt (niet onbruikbaar) when sourceLocationIssue is expliciet MISSING', () => {
    const vm = buildProjectDetailsLocationViewModel(workVersion({ sourceLocationIssue: 'MISSING' }), undefined);
    expect(vm).toMatchObject({ isLocationBronMissing: true, isLocationBronUnusablePrimary: false });
  });

  it('is bron onbruikbaar with a begrijpelijke reden for een zelfkruisende bron, geen download', () => {
    const vm = buildProjectDetailsLocationViewModel(workVersion({ sourceLocationIssue: 'SELF_INTERSECTING' }), undefined);
    expect(vm).toMatchObject({ isLocationBronUnusablePrimary: true, locationBronIssueMessage: 'zelfkruising', locationCanDownload: false });
  });

  it('is handmatig geldig when a manualLocationPolygon exists, ongeacht de bronstatus', () => {
    const vm = buildProjectDetailsLocationViewModel(
      workVersion({ manualLocationPolygon: POLYGON, manualLocationSetAt: '2026-09-25T10:00:00.000Z', manualLocationSetBy: 'medewerker@example.nl' }),
      undefined,
    );
    expect(vm).toMatchObject({
      isLocationManual: true, locationManualSetByLabel: 'medewerker@example.nl', locationManualSetAtLabel: '25 september 2026 10:00', locationCanDownload: true,
    });
  });

  it('toont de bronfout alleen als context onder de handmatige locatie, nooit als actieve downloadstatus', () => {
    const vm = buildProjectDetailsLocationViewModel(
      workVersion({ manualLocationPolygon: POLYGON, sourceLocationIssue: 'SELF_INTERSECTING' }), undefined,
    );
    expect(vm.isLocationManual).toBe(true);
    expect(vm.isLocationBronUnusableContext).toBe(true);
    expect(vm.isLocationBronUnusablePrimary).toBe(false);
    expect(vm.locationBronIssueMessage).toBe('zelfkruising');
    expect(vm.locationCanDownload).toBe(true);
  });

  it('vertaalt een geldige locationErrorCode naar een bruikbare tekst', () => {
    const vm = buildProjectDetailsLocationViewModel(workVersion(), 'MULTIPLE_FEATURES');
    expect(vm.locationErrorMessage).toBe('Er staan meerdere vlakken in deze GeoJSON. Plak precies één vlak.');
  });

  it('negeert een onbekende locationErrorCode in plaats van te crashen op een gemanipuleerde query-parameter', () => {
    const vm = buildProjectDetailsLocationViewModel(workVersion(), 'ONBEKENDE_CODE');
    expect(vm.locationErrorMessage).toBeUndefined();
  });

  it('geeft alle velden een veilige standaardwaarde zonder werkversie (NEW/PENDING/FAILED/UNAVAILABLE)', () => {
    const vm = buildProjectDetailsLocationViewModel(undefined, undefined);
    expect(vm).toMatchObject({
      isLocationManual: false,
      isLocationBronValid: false,
      isLocationBronMissing: true,
      isLocationBronUnusablePrimary: false,
      isLocationBronUnusableContext: false,
      locationCanDownload: false,
    });
  });
});
