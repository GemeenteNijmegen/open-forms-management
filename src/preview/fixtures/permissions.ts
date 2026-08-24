import { PermissionAdministrationPolicy } from '../../app/permissions/administration/PermissionAdministrationPolicy';
import { PermissionAdministrationService } from '../../app/permissions/administration/PermissionAdministrationService';
import { PermissionCatalog } from '../../app/permissions/catalog/PermissionCatalog';
import { REGISTERED_PERMISSION_RESOURCES } from '../../app/permissions/catalog/RegisteredPermissionResources';
import { buildEditResources, buildOverviewRecord } from '../../app/permissions/ui-request-handlers/PermissionsViewModel';
import { SPORT_DISTRICTS } from '../../app/sport/sportdata/SportDistrictAuthorization';
import { PermissionEvaluator } from '../../shared/authorization/PermissionEvaluator';
import { PermissionGrant } from '../../shared/authorization/PermissionGrant';
import { Feature } from '../../shared/navigation/Feature';
import { PageViewModel } from '../../shared/rendering/Renderer';
import { CSRF_FORM_FIELD } from '../../shared/security/csrf/CsrfProtection';

const sportFeature: Feature = { id: 'sport', label: 'Sport', route: '/sport', resource: 'sport', action: 'view' };
const permissionsFeature: Feature = { id: 'permissions', label: 'Gebruikers', route: '/permissions', resource: 'permissions', action: 'view' };

// Preview-only: a fictional second resource next to the real Sport registration, so the superadmin preview
// can show the generic multi-resource projection without adding a fake resource to the real catalog.
const previewCatalog = new PermissionCatalog([
  ...REGISTERED_PERMISSION_RESOURCES,
  {
    resource: 'formulieren',
    label: 'Formulieren beheren',
    actions: [{ action: 'view', label: 'Bekijken' }, { action: 'edit', label: 'Wijzigen' }],
    scopes: [{
      key: 'organisations',
      label: 'Organisaties',
      values: [{ value: 'organisatie-a', label: 'Organisatie A' }, { value: 'organisatie-b', label: 'Organisatie B' }],
    }],
  },
]);
const previewService = new PermissionAdministrationService(previewCatalog, new PermissionAdministrationPolicy(previewCatalog));

function record(actor: PermissionEvaluator, email: string, grants: PermissionGrant[]) {
  return buildOverviewRecord(email, previewService.projectUser(actor, grants));
}

const superadminActor = new PermissionEvaluator([{ resource: '*', actions: ['*'] }]);

export const permissionsSuperadmin: { page: PageViewModel; data: { records: ReturnType<typeof record>[] } } = {
  page: { title: 'Gebruikers en rechten', features: [permissionsFeature], currentPath: '/permissions', actorEmail: 'beheerder@example.invalid' },
  data: {
    records: [
      record(superadminActor, 'nieuwe-medewerker@example.invalid', []),
      record(superadminActor, 'sportbeheerder@example.invalid', [{ resource: 'sport', actions: ['*'] }]),
      record(superadminActor, 'medewerker-sport@example.invalid', [
        { resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } },
      ]),
      record(superadminActor, 'medewerker-meerdere-onderdelen@example.invalid', [
        { resource: 'sport', actions: ['view'], scopes: { districts: ['nijmegenCentrum'] } },
        { resource: 'formulieren', actions: ['view', 'edit'], scopes: { organisations: ['organisatie-a', 'organisatie-b'] } },
      ]),
      record(superadminActor, 'andere-beheerder@example.invalid', [{ resource: '*', actions: ['*'] }]),
    ],
  },
};

const sportAdminActor = new PermissionEvaluator([{ resource: 'sport', actions: ['*'] }]);

export const permissionsSportAdmin: { page: PageViewModel; data: { records: ReturnType<typeof record>[] } } = {
  page: {
    title: 'Gebruikers en rechten', features: [sportFeature, permissionsFeature], currentPath: '/permissions', actorEmail: 'sportbeheerder@example.invalid',
  },
  data: {
    records: [
      record(sportAdminActor, 'medewerker-een-wijk@example.invalid', [
        { resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg'] } },
      ]),
      record(sportAdminActor, 'medewerker-veel-wijken@example.invalid', [
        { resource: 'sport', actions: ['view'], scopes: { districts: [...SPORT_DISTRICTS] } },
      ]),
      record(sportAdminActor, 'mede-sportbeheerder@example.invalid', [{ resource: 'sport', actions: ['*'] }]),
    ],
  },
};

// Superadmin editing a multi-resource user: proves buildEditResources() stays generic across Sport (districts)
// and the fictional Formulieren resource (organisations) without any resource-specific template code.
const multiResourceTargetGrants: PermissionGrant[] = [
  { resource: '*', actions: ['*'] },
  { resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg', 'nijmegenOost'] } },
  { resource: 'formulieren', actions: ['edit'], scopes: { organisations: ['organisatie-a'] } },
];
const multiResourcePermissions = previewService.projectUser(superadminActor, multiResourceTargetGrants);

export const permissionsUserMultiResource: { page: PageViewModel; data: Record<string, unknown> } = {
  page: {
    title: 'Rechten van medewerker-meerdere-onderdelen@example.invalid',
    features: [permissionsFeature],
    currentPath: '/permissions',
    actorEmail: 'beheerder@example.invalid',
  },
  data: {
    targetEmail: 'medewerker-meerdere-onderdelen@example.invalid',
    generalGrants: multiResourcePermissions.generalGrants,
    resources: buildEditResources(previewService.manageableResources(superadminActor), multiResourceTargetGrants),
    csrfField: CSRF_FORM_FIELD,
    csrfToken: 'preview-token',
  },
};

export const permissionsRemoveConfirm: { page: PageViewModel; data: Record<string, unknown> } = {
  page: { title: 'Verwijderen uit Sport', features: [sportFeature, permissionsFeature], currentPath: '/permissions', actorEmail: 'sportbeheerder@example.invalid' },
  data: {
    targetEmail: 'medewerker-een-wijk@example.invalid',
    resource: 'sport',
    resourceLabel: 'Sport',
    csrfField: CSRF_FORM_FIELD,
    csrfToken: 'preview-token',
  },
};
