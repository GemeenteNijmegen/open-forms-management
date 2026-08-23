import { SportFilter } from '../../app/sport/aanmeldingen/SportFilter';
import { SportSubmissionsPage } from '../../app/sport/aanmeldingen/SportSubmissionsOrdering';
import { buildSportShellViewModel, buildSportSubmissionsFragmentViewModel, SportSubmissionsFragmentViewModel } from '../../app/sport/aanmeldingen/SportViewModel';
import { SportDistrict } from '../../app/sport/sportdata/SportDistrictAuthorization';
import { SportSubmission } from '../../app/sport/sportdata/SportSubmission';
import { Feature } from '../../shared/navigation/Feature';
import { PageViewModel } from '../../shared/rendering/Renderer';

const sportFeature: Feature = { id: 'sport', label: 'Sport', route: '/sport', resource: 'sport', action: 'view' };

function sportPage(actorEmail: string): PageViewModel {
  return { title: 'Sport', features: [sportFeature], currentPath: '/sport', actorEmail };
}

// The unfiltered default: every shown district selected, both aanmeldTypes selected.
function unfiltered(districts: SportDistrict[]): SportFilter {
  return { districts, types: ['kind', 'volwassene'] };
}

// Namen/scholen/opmerkingen zijn overal bewust generieke "Test..."-waarden, geen realistische namen: dit is
// preview-/testdata, geen echte medewerkers of aanmelders.
const childDukenburg: SportSubmission = {
  reference: 'OF-2026-00142',
  submittedAt: new Date('2026-08-20T10:15:00Z'),
  district: 'dukenburg',
  aanmeldType: 'kind',
  contactName: 'Testouder Dukenburg',
  phone: '0600000001',
  email: 'test-ouder-dukenburg@example.invalid',
  activities: ['zwemles voor kinderen (zwembad Dukenburg)', 'gymnastiek voor kinderen (sporthal Meijhorst)'],
  child: { name: 'Testkind Dukenburg', birthDate: '2015-04-02', school: 'Testschool Dukenburg' },
  objectUuid: 'preview-child-dukenburg',
  hasPdf: true,
};

const adultDukenburg: SportSubmission = {
  reference: 'OF-2026-00151',
  submittedAt: new Date('2026-08-21T08:05:00Z'),
  district: 'dukenburg',
  aanmeldType: 'volwassene',
  contactName: 'Testvolwassene Dukenburg',
  phone: '0600000002',
  email: 'test-volwassene-dukenburg@example.invalid',
  activities: ['bewegen op muziek voor dames/vrouwen (wijkcentrum Dukenburg)'],
  remark: 'Testopmerking: voorkeur voor de ochtend.',
  objectUuid: 'preview-adult-dukenburg',
  hasPdf: true,
};

const childCentrum: SportSubmission = {
  reference: 'OF-2026-00098',
  submittedAt: new Date('2026-08-19T14:30:00Z'),
  district: 'nijmegenCentrum',
  aanmeldType: 'kind',
  contactName: 'Testouder Centrum',
  phone: '0600000003',
  email: 'test-ouder-centrum@example.invalid',
  activities: ['voetbaltraining voor kinderen (sportpark Staddijk)', 'behendigheidstraining voor kinderen (sporthal Wedren)'],
  remark: 'Testopmerking: nieuw bij deze groep, graag extra begeleiding in het begin.',
  child: { name: 'Testkind Centrum', birthDate: '2012-09-10', school: 'Testschool Centrum' },
  objectUuid: 'preview-child-centrum',
  hasPdf: true,
};

const childNoord: SportSubmission = {
  reference: 'OF-2026-00075',
  submittedAt: new Date('2026-08-18T09:00:00Z'),
  district: 'nijmegenNoord',
  aanmeldType: 'kind',
  contactName: 'Testouder Noord',
  phone: '0600000004',
  email: 'test-ouder-noord@example.invalid',
  activities: ['zwemles voor kinderen (zwembad Aquireno)', 'atletiek voor kinderen (atletiekbaan Nijmegen-Noord)'],
  child: { name: 'Testkind Noord', birthDate: '2011-01-20', school: 'Testschool Noord' },
  objectUuid: 'preview-child-noord',
  hasPdf: true,
};

const childLindenholt: SportSubmission = {
  reference: 'OF-2026-00061',
  submittedAt: new Date('2026-08-17T11:20:00Z'),
  district: 'lindenholt',
  aanmeldType: 'kind',
  contactName: 'Testouder Lindenholt',
  phone: '0600000005',
  email: 'test-ouder-lindenholt@example.invalid',
  activities: ['gymnastiek voor kinderen (sporthal Lindenholt)', 'dansles voor kinderen (wijkcentrum Meijhorst)'],
  child: { name: 'Testkind Lindenholt', birthDate: '2013-06-15', school: 'Testschool Lindenholt' },
  objectUuid: 'preview-child-lindenholt',
  hasPdf: true,
};

// No pdf reference: shows that a record without one gets no active downloadlink.
const childOost: SportSubmission = {
  reference: 'OF-2026-00050',
  submittedAt: new Date('2026-08-16T13:45:00Z'),
  district: 'nijmegenOost',
  aanmeldType: 'kind',
  contactName: 'Testouder Oost',
  phone: '0600000006',
  email: 'test-ouder-oost@example.invalid',
  activities: ['voetbaltraining voor kinderen (sportpark Ooijse Bandijk)', 'behendigheidstraining voor kinderen (sporthal Grootstal)'],
  remark: 'Testopmerking voor het testen van langere vrije tekst in de detailregel: deze zin is expres wat langer om '
    + 'regelafbreking en tekstterugloop in de kaart te controleren, zonder verdere betekenis.',
  child: { name: 'Testkind Oost', birthDate: '2014-11-03', school: 'Testschool Oost' },
  hasPdf: false,
};

const childMiddenZuid: SportSubmission = {
  reference: 'OF-2026-00044',
  submittedAt: new Date('2026-08-15T15:10:00Z'),
  district: 'nijmegenMiddenZuid',
  aanmeldType: 'kind',
  contactName: 'Testouder MiddenZuid',
  phone: '0600000007',
  email: 'test-ouder-middenzuid@example.invalid',
  activities: ['zwemles voor kinderen (zwembad Erica)', 'turnen voor kinderen (sporthal Hatertseveld)'],
  child: { name: 'Testkind MiddenZuid', birthDate: '2012-02-28', school: 'Testschool MiddenZuid' },
  objectUuid: 'preview-child-midden-zuid',
  hasPdf: true,
};

const childOudNieuwWest: SportSubmission = {
  reference: 'OF-2026-00033',
  submittedAt: new Date('2026-08-14T16:30:00Z'),
  district: 'nijmegenOudNieuwWest',
  aanmeldType: 'kind',
  contactName: 'Testouder OudNieuwWest',
  phone: '0600000008',
  email: 'test-ouder-oudnieuwwest@example.invalid',
  activities: ['gymnastiek voor kinderen (sporthal B-Fit)', 'voetbaltraining voor kinderen (sportpark Wolfskuil)'],
  child: { name: 'Testkind OudNieuwWest', birthDate: '2015-09-19', school: 'Testschool OudNieuwWest' },
  objectUuid: 'preview-child-oud-nieuw-west',
  hasPdf: true,
};

// A kind-aanmelding with everything filled in, including a long school name and multiple long
// activities, to check wrapping when a record has as much content as realistically possible.
const childRichData: SportSubmission = {
  reference: 'OF-2026-00201',
  submittedAt: new Date('2026-08-22T09:30:00Z'),
  district: 'nijmegenNoord',
  aanmeldType: 'kind',
  contactName: 'Testouder Noord Uitgebreid',
  phone: '0600000009',
  email: 'test-ouder-noord-uitgebreid@example.invalid',
  activities: [
    'bewegen op muziek voor dames/vrouwen (wijkcentrum Dukenburg)',
    'seniorensport: sport- en spelactiviteiten voor senioren (wijkcentrum Dukenburg)',
  ],
  remark: 'Testopmerking rijke data: nog een voorbeeld van een langere vrije-tekstinvoer, puur om lay-out en '
    + 'tekstterugloop te controleren en verder zonder inhoudelijke betekenis.',
  child: { name: 'Testkind Noord Uitgebreid', birthDate: '2016-03-11', school: 'Testschool Noord Uitgebreid (langere naam voor terugloop)' },
  objectUuid: 'preview-child-rich-data',
  hasPdf: true,
};

// A volwassene-aanmelding with one long activity label and no remark.
const adultLongActivity: SportSubmission = {
  reference: 'OF-2026-00202',
  submittedAt: new Date('2026-08-22T10:00:00Z'),
  district: 'nijmegenCentrum',
  aanmeldType: 'volwassene',
  contactName: 'Testvolwassene Centrum',
  phone: '0600000010',
  email: 'test-volwassene-centrum@example.invalid',
  activities: ['onbeperkt wijksporten: sport- en spelactiviteiten voor volwassenen (sporthal Meijhorst)'],
  objectUuid: 'preview-adult-long-activity',
  hasPdf: true,
};

// A kind-aanmelding missing every optional field (no birthDate, no school, no remark).
const childMinimalData: SportSubmission = {
  reference: 'OF-2026-00203',
  submittedAt: new Date('2026-08-22T10:30:00Z'),
  district: 'lindenholt',
  aanmeldType: 'kind',
  contactName: 'Testouder Lindenholt Minimaal',
  phone: '0600000011',
  email: 'test-ouder-lindenholt-minimaal@example.invalid',
  activities: ['Niet van toepassing'],
  child: { name: 'Testkind Lindenholt Minimaal' },
  objectUuid: 'preview-child-minimal-data',
  hasPdf: true,
};

const allDistricts: SportDistrict[] = [
  'nijmegenCentrum', 'nijmegenOost', 'nijmegenMiddenZuid', 'nijmegenOudNieuwWest', 'dukenburg', 'lindenholt', 'nijmegenNoord',
];

// Shell only (tabs, visible-period text, filter form, refresh button, empty spinner container): the
// submissions list itself is a separate fragment the browser fetches, previewed below.
export const sportShellAllDistricts = {
  page: sportPage('admin@nijmegen.nl'),
  data: buildSportShellViewModel(allDistricts, unfiltered(allDistricts), '23 juli 2026'),
};

export const sportShellDukenburg = {
  page: sportPage('medewerker@nijmegen.nl'),
  data: buildSportShellViewModel(['dukenburg'], unfiltered(['dukenburg']), '23 juli 2026'),
};

function fragment(
  submissions: SportSubmission[], staleWarning = false, overrides: { hasMore?: boolean; nextCursor?: string } = {},
): SportSubmissionsFragmentViewModel {
  const page: SportSubmissionsPage = {
    submissions, hasMore: overrides.hasMore ?? false, ...(overrides.nextCursor ? { nextCursor: overrides.nextCursor } : {}),
  };
  return buildSportSubmissionsFragmentViewModel(page, staleWarning);
}

export const sportSubmissionsAllDistricts = fragment(
  [childDukenburg, adultDukenburg, childCentrum, childNoord, childLindenholt, childOost, childMiddenZuid, childOudNieuwWest],
);

export const sportSubmissionsDukenburg = fragment([childDukenburg, adultDukenburg]);

export const sportSubmissionsEmpty = fragment([]);

export const sportSubmissionsStale = fragment([childDukenburg], true);

export const sportSubmissionsHasMore = fragment([childDukenburg, adultDukenburg], false, { hasMore: true, nextCursor: 'preview-cursor' });

// Content edge cases in one preview: a fully filled-in record with long text, a long single
// activity, and a record missing every optional field, for judging the record layout itself.
export const sportSubmissionsContentVariety = fragment([childRichData, adultLongActivity, childMinimalData]);
