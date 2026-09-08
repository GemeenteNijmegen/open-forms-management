import { Feature } from './Feature';

// Home and every feature page render the sidenav from this same list, so it stays consistent everywhere.
// The two woonbehoefte entries share a dedupeKey: a medewerker with only exceloverzicht lands on
// /woonbehoefte/overzichten, a medewerker with view (with or without exceloverzicht) lands on
// /woonbehoefte - order matters here, view comes first so it wins when both are present.
export const REGISTERED_FEATURES: Feature[] = [
  {
    id: 'sport',
    label: 'Sport',
    route: '/sport',
    resource: 'sport',
    action: 'view',
  },
  {
    id: 'woonbehoefte-view',
    label: 'Woonbehoefte',
    route: '/woonbehoefte',
    resource: 'woonbehoefte',
    action: 'view',
    dedupeKey: 'woonbehoefte',
  },
  {
    id: 'woonbehoefte-exceloverzicht',
    label: 'Woonbehoefte',
    route: '/woonbehoefte/overzichten',
    resource: 'woonbehoefte',
    action: 'exceloverzicht',
    dedupeKey: 'woonbehoefte',
  },
];
