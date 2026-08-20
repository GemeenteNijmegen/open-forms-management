import { Feature } from '../../shared/navigation/Feature';
import { PageViewModel } from '../../shared/rendering/Renderer';

const exampleFeatures: Feature[] = [
  { id: 'formulieren', label: 'Formulieren beheren', route: '/formulieren', resource: 'formulieren', action: 'view' },
  { id: 'permissies', label: 'Permissies beheren', route: '/permissies', resource: 'permissies', action: 'view' },
  { id: 'auditlog', label: 'Audit log bekijken', route: '/auditlog', resource: 'auditlog', action: 'view' },
];

export const homeWithFeatures: PageViewModel = {
  title: 'Home', features: exampleFeatures, currentPath: '/', actorEmail: 'medewerker@nijmegen.nl',
};

export const homeEmpty: PageViewModel = {
  title: 'Home', features: [], currentPath: '/', actorEmail: 'medewerker@nijmegen.nl',
};

export const notFoundData: PageViewModel = {
  title: 'Pagina niet gevonden', features: [], currentPath: '/onbekend-pad', actorEmail: 'medewerker@nijmegen.nl',
};
