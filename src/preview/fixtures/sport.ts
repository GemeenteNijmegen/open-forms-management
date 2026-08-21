import { SportDistrict } from '../../app/sport/SportDistrictAuthorization';
import { SportFilter } from '../../app/sport/SportFilter';
import { SportSubmission } from '../../app/sport/SportSubmission';
import { buildSportViewModel } from '../../app/sport/SportViewModel';
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

const childDukenburg: SportSubmission = {
  reference: 'OF-2026-00142',
  submittedAt: new Date('2026-08-20T10:15:00Z'),
  district: 'dukenburg',
  aanmeldType: 'kind',
  contactName: 'Marieke Jansen',
  phone: '0612345678',
  email: 'marieke.jansen@example.invalid',
  activities: ['zwemles voor kinderen (zwembad Dukenburg)', 'gymnastiek voor kinderen (sporthal Meijhorst)'],
  child: { name: 'Sanne Jansen', birthDate: '2015-04-02', school: 'De Windroos' },
};

const adultDukenburg: SportSubmission = {
  reference: 'OF-2026-00151',
  submittedAt: new Date('2026-08-21T08:05:00Z'),
  district: 'dukenburg',
  aanmeldType: 'volwassene',
  contactName: 'Peter de Groot',
  phone: '0687654321',
  email: 'peter.degroot@example.invalid',
  activities: ['bewegen op muziek voor dames/vrouwen (wijkcentrum Dukenburg)'],
  remark: 'Graag in de ochtend.',
};

const childCentrum: SportSubmission = {
  reference: 'OF-2026-00098',
  submittedAt: new Date('2026-08-19T14:30:00Z'),
  district: 'nijmegenCentrum',
  aanmeldType: 'kind',
  contactName: 'Fatima El Idrissi',
  phone: '0623456789',
  email: 'fatima.elidrissi@example.invalid',
  activities: ['voetbaltraining voor kinderen (sportpark Staddijk)', 'behendigheidstraining voor kinderen (sporthal Wedren)'],
  remark: 'Ons kind vindt het spannend om nieuwe kinderen te ontmoeten, graag extra aandacht van de begeleiding in het begin.',
  child: { name: 'Yusuf El Idrissi', birthDate: '2012-09-10', school: 'Basisschool De Vuurvogel' },
};

const childNoord: SportSubmission = {
  reference: 'OF-2026-00075',
  submittedAt: new Date('2026-08-18T09:00:00Z'),
  district: 'nijmegenNoord',
  aanmeldType: 'kind',
  contactName: 'Tom Willemsen',
  phone: '0634567890',
  email: 'tom.willemsen@example.invalid',
  activities: ['zwemles voor kinderen (zwembad Aquireno)', 'atletiek voor kinderen (atletiekbaan Nijmegen-Noord)'],
  child: { name: 'Lars Willemsen', birthDate: '2011-01-20', school: 'Basisschool Het Kompas' },
};

const childLindenholt: SportSubmission = {
  reference: 'OF-2026-00061',
  submittedAt: new Date('2026-08-17T11:20:00Z'),
  district: 'lindenholt',
  aanmeldType: 'kind',
  contactName: 'Sofia Bakker',
  phone: '0645678901',
  email: 'sofia.bakker@example.invalid',
  activities: ['gymnastiek voor kinderen (sporthal Lindenholt)', 'dansles voor kinderen (wijkcentrum Meijhorst)'],
  child: { name: 'Milan Bakker', birthDate: '2013-06-15', school: 'Basisschool De Sterrenkijker' },
};

const childOost: SportSubmission = {
  reference: 'OF-2026-00050',
  submittedAt: new Date('2026-08-16T13:45:00Z'),
  district: 'nijmegenOost',
  aanmeldType: 'kind',
  contactName: 'Anna van Dijk',
  phone: '0656789012',
  email: 'anna.vandijk@example.invalid',
  activities: ['voetbaltraining voor kinderen (sportpark Ooijse Bandijk)', 'behendigheidstraining voor kinderen (sporthal Grootstal)'],
  remark: 'Onze dochter kan alleen op woensdagmiddag, de rest van de week zit de agenda vol met schoolzwemmen en andere naschoolse activiteiten. Graag zo veel mogelijk rekening houden met die ene beschikbare middag.',
  child: { name: 'Noa van Dijk', birthDate: '2014-11-03', school: 'Basisschool De Wijngaard' },
};

const childMiddenZuid: SportSubmission = {
  reference: 'OF-2026-00044',
  submittedAt: new Date('2026-08-15T15:10:00Z'),
  district: 'nijmegenMiddenZuid',
  aanmeldType: 'kind',
  contactName: 'Youssef Amrani',
  phone: '0667890123',
  email: 'youssef.amrani@example.invalid',
  activities: ['zwemles voor kinderen (zwembad Erica)', 'turnen voor kinderen (sporthal Hatertseveld)'],
  child: { name: 'Amir Amrani', birthDate: '2012-02-28', school: 'Basisschool De Meridiaan' },
};

const childOudNieuwWest: SportSubmission = {
  reference: 'OF-2026-00033',
  submittedAt: new Date('2026-08-14T16:30:00Z'),
  district: 'nijmegenOudNieuwWest',
  aanmeldType: 'kind',
  contactName: 'Els Hermans',
  phone: '0678901234',
  email: 'els.hermans@example.invalid',
  activities: ['gymnastiek voor kinderen (sporthal B-Fit)', 'voetbaltraining voor kinderen (sportpark Wolfskuil)'],
  child: { name: 'Fenna Hermans', birthDate: '2015-09-19', school: 'Basisschool De Regenboog' },
};

// A kind-aanmelding with everything filled in, including a long school name and multiple long
// activities, to check wrapping when a record has as much content as realistically possible.
const childRichData: SportSubmission = {
  reference: 'OF-2026-00201',
  submittedAt: new Date('2026-08-22T09:30:00Z'),
  district: 'nijmegenNoord',
  aanmeldType: 'kind',
  contactName: 'Karin de Wit-Vermeulen',
  phone: '0611223344',
  email: 'karin.dewit.vermeulen@example.invalid',
  activities: [
    'bewegen op muziek voor dames/vrouwen (wijkcentrum Dukenburg)',
    'seniorensport: sport- en spelactiviteiten voor senioren (wijkcentrum Dukenburg)',
  ],
  remark: 'Ons kind heeft een lichte beperking en kan het beste vooraan bij de instructeur staan, graag rekening houden met de indeling van de groep.',
  child: { name: 'Bram de Wit-Vermeulen', birthDate: '2016-03-11', school: 'Basisschool Sint Jozef aan de Nieuwe Ubbergseweg' },
};

// A volwassene-aanmelding with one long activity label and no remark.
const adultLongActivity: SportSubmission = {
  reference: 'OF-2026-00202',
  submittedAt: new Date('2026-08-22T10:00:00Z'),
  district: 'nijmegenCentrum',
  aanmeldType: 'volwassene',
  contactName: 'Willem Overbeek',
  phone: '0622334455',
  email: 'willem.overbeek@example.invalid',
  activities: ['onbeperkt wijksporten: sport- en spelactiviteiten voor volwassenen (sporthal Meijhorst)'],
};

// A kind-aanmelding missing every optional field (no birthDate, no school, no remark).
const childMinimalData: SportSubmission = {
  reference: 'OF-2026-00203',
  submittedAt: new Date('2026-08-22T10:30:00Z'),
  district: 'lindenholt',
  aanmeldType: 'kind',
  contactName: 'Petra Jansen',
  phone: '0633445566',
  email: 'petra.jansen@example.invalid',
  activities: ['Niet van toepassing'],
  child: { name: 'Noor Jansen' },
};

const allDistricts: SportDistrict[] = [
  'nijmegenCentrum', 'nijmegenOost', 'nijmegenMiddenZuid', 'nijmegenOudNieuwWest', 'dukenburg', 'lindenholt', 'nijmegenNoord',
];

export const sportAllDistricts = {
  page: sportPage('admin@nijmegen.nl'),
  data: buildSportViewModel(
    allDistricts,
    unfiltered(allDistricts),
    [childDukenburg, adultDukenburg, childCentrum, childNoord, childLindenholt, childOost, childMiddenZuid, childOudNieuwWest],
    0,
  ),
};

export const sportDukenburg = {
  page: sportPage('medewerker@nijmegen.nl'),
  data: buildSportViewModel(['dukenburg'], unfiltered(['dukenburg']), [childDukenburg, adultDukenburg], 0),
};

export const sportEmpty = {
  page: sportPage('medewerker@nijmegen.nl'),
  data: buildSportViewModel(['dukenburg'], unfiltered(['dukenburg']), [], 0),
};

export const sportPartialError = {
  page: sportPage('medewerker@nijmegen.nl'),
  data: buildSportViewModel(['dukenburg', 'nijmegenCentrum'], unfiltered(['dukenburg', 'nijmegenCentrum']), [childDukenburg, childCentrum], 1),
};

export const sportFiltered = {
  page: sportPage('medewerker@nijmegen.nl'),
  data: buildSportViewModel(
    ['dukenburg', 'nijmegenCentrum'],
    { districts: ['dukenburg'], types: ['kind'] },
    [childDukenburg],
    0,
  ),
};

// Content edge cases in one preview: a fully filled-in record with long text, a long single
// activity, and a record missing every optional field. For judging the record layout itself, not
// for a specific wijk/type scenario (those are covered by the variants above).
export const sportContentVariety = {
  page: sportPage('medewerker@nijmegen.nl'),
  data: buildSportViewModel(
    ['dukenburg', 'nijmegenCentrum', 'nijmegenNoord', 'lindenholt'],
    unfiltered(['dukenburg', 'nijmegenCentrum', 'nijmegenNoord', 'lindenholt']),
    [childRichData, adultLongActivity, childMinimalData],
    0,
  ),
};
