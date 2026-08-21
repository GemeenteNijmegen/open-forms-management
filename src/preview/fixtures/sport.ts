import { SportSubmission } from '../../app/sport/SportSubmission';
import { buildSportViewModel } from '../../app/sport/SportViewModel';
import { Feature } from '../../shared/navigation/Feature';
import { PageViewModel } from '../../shared/rendering/Renderer';

const sportFeature: Feature = { id: 'sport', label: 'Sport', route: '/sport', resource: 'sport', action: 'view' };

function sportPage(actorEmail: string): PageViewModel {
  return { title: 'Sport', features: [sportFeature], currentPath: '/sport', actorEmail };
}

const childDukenburg: SportSubmission = {
  reference: 'OF-2026-00142',
  submittedAt: new Date('2026-08-20T10:15:00Z'),
  district: 'dukenburg',
  aanmeldType: 'kind',
  contactName: 'Marieke Jansen',
  phone: '0612345678',
  email: 'marieke.jansen@example.invalid',
  activities: ['Niet van toepassing'],
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
  activities: ['Niet van toepassing'],
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
  activities: ['Niet van toepassing'],
  child: { name: 'Lars Willemsen', birthDate: '2011-01-20', school: 'Basisschool Het Kompas' },
};

export const sportAllDistricts = {
  page: sportPage('admin@nijmegen.nl'),
  data: buildSportViewModel(['dukenburg', 'nijmegenCentrum', 'nijmegenNoord'], [childDukenburg, adultDukenburg, childCentrum, childNoord], 0),
};

export const sportDukenburg = {
  page: sportPage('medewerker@nijmegen.nl'),
  data: buildSportViewModel(['dukenburg'], [childDukenburg, adultDukenburg], 0),
};

export const sportEmpty = {
  page: sportPage('medewerker@nijmegen.nl'),
  data: buildSportViewModel(['dukenburg'], [], 0),
};

export const sportPartialError = {
  page: sportPage('medewerker@nijmegen.nl'),
  data: buildSportViewModel(['dukenburg', 'nijmegenCentrum'], [childDukenburg, childCentrum], 1),
};
