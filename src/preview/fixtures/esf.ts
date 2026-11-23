import { Feature } from '../../shared/navigation/Feature';

const esfFeature: Feature = { id: 'esf', label: 'ESF-controle', route: '/esf', resource: 'esf', action: 'view' };

export const esfSearchForm = {
  page: { title: 'ESF-controle', features: [esfFeature], currentPath: '/esf', actorEmail: 'medewerker@nijmegen.nl' },
  data: { csrfField: 'csrfToken', csrfToken: 'preview-csrf-token' },
};
