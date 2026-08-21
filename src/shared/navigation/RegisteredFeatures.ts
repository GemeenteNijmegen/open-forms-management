import { Feature } from './Feature';

// Home and every feature page render the sidenav from this same list, so it stays consistent everywhere.
export const REGISTERED_FEATURES: Feature[] = [
  {
    id: 'sport',
    label: 'Sport',
    route: '/sport',
    resource: 'sport',
    action: 'view',
  },
];
