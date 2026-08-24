import { Feature } from '../../shared/navigation/Feature';
import { PageViewModel } from '../../shared/rendering/Renderer';

const exampleFeatures: Feature[] = [
  { id: 'sport', label: 'Sport', route: '/sport', resource: 'sport', action: 'view' },
  { id: 'formulieren', label: 'Formulieren beheren', route: '/formulieren', resource: 'formulieren', action: 'view' },
  { id: 'permissies', label: 'Permissies beheren', route: '/permissies', resource: 'permissies', action: 'view' },
  { id: 'auditlog', label: 'Audit log bekijken', route: '/auditlog', resource: 'auditlog', action: 'view' },
];

export const homeWithFeatures: PageViewModel = {
  title: 'Home', features: exampleFeatures, currentPath: '/', actorEmail: 'medewerker@nijmegen.nl',
};

// A medewerker with zero usable grants never actually sees home.mustache with empty features: they land on
// the dedicated no-permissions page instead, see HomeRequestHandler.ts.
export const noPermissionsData: PageViewModel = {
  title: 'Geen toegang', features: [], currentPath: '/', actorEmail: 'medewerker@nijmegen.nl',
};

export const notFoundData: PageViewModel = {
  title: 'Pagina niet gevonden', features: [], currentPath: '/onbekend-pad', actorEmail: 'medewerker@nijmegen.nl',
};
