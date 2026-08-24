import { PermissionResourceDefinition } from './PermissionResourceDefinition';
import { SPORT_DISTRICTS, SPORT_DISTRICT_LABELS } from '../../sport/sportdata/SportDistrictAuthorization';

export const REGISTERED_PERMISSION_RESOURCES: PermissionResourceDefinition[] = [
  {
    resource: 'sport',
    label: 'Sport',
    actions: [
      { action: 'view', label: 'Bekijken' },
    ],
    scopes: [
      {
        key: 'districts',
        label: 'Wijken',
        values: SPORT_DISTRICTS.map((district) => ({ value: district, label: SPORT_DISTRICT_LABELS[district] })),
      },
    ],
  },
];
