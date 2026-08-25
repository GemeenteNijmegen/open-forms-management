import { PermissionGrant } from '../../../shared/authorization/PermissionGrant';
import { PermissionResourceViewModel, PermissionUserViewModel } from '../administration/PermissionAdministrationService';
import { PermissionResourceDefinition } from '../catalog/PermissionResourceDefinition';

export interface PermissionOverviewUserViewModel {
  email: string;
  summary: string;
  generalGrants: PermissionUserViewModel['generalGrants'];
  resources: PermissionResourceViewModel[];
  canEdit: boolean;
}

export interface PermissionEditValueViewModel {
  value: string;
  label: string;
  checked: boolean;
}

export interface PermissionEditScopeViewModel {
  key: string;
  label: string;
  values: PermissionEditValueViewModel[];
}

export interface PermissionEditResourceViewModel {
  resource: string;
  label: string;
  hasExistingGrants: boolean;
  isResourceAdmin: boolean;
  actions: PermissionEditValueViewModel[];
  scopes: PermissionEditScopeViewModel[];
}

/** Joins the labels a medewerker actually has grants for; "Geen rechten" for a subject with none of them. */
export function buildSummary(generalGrants: PermissionUserViewModel['generalGrants'], resources: PermissionResourceViewModel[]): string {
  const resourceLabels = resources.map((resource) => resource.label);
  const parts = generalGrants.length > 0 ? ['Superadmin', ...resourceLabels] : resourceLabels;
  return parts.length > 0 ? parts.join(' · ') : 'Geen rechten';
}

/**
 * The read-only overview only ever shows resources the medewerker actually has grants for; projectUser() also
 * includes every manageable-but-empty resource, because the same projection prefills the later edit form.
 * canEdit is false whenever generalGrants is non-empty: that only happens for a global-admin actor looking at
 * a target who is a superadmin too, and superadmin lifecycle is not something this UI edits or removes.
 */
export function buildOverviewRecord(email: string, permissions: PermissionUserViewModel): PermissionOverviewUserViewModel {
  const resources = permissions.resources.filter((resource) => resource.grants.length > 0);
  return {
    email,
    summary: buildSummary(permissions.generalGrants, resources),
    generalGrants: permissions.generalGrants,
    resources,
    canEdit: permissions.generalGrants.length === 0,
  };
}

/**
 * Builds one editable form per manageable resource, driven entirely by the catalog: every registered action and
 * scope value is listed, checked when the target's current grants for that resource include it. A resource the
 * target has no grant for yet still gets a full, unchecked form, since adding a resource and changing it are
 * the same edit page. generalGrants (for example Superadmin) is shown here as read-only info, not as an
 * editable form: granting or revoking global admin rights is not something this UI does.
 */
export function buildEditResources(
  manageableResources: PermissionResourceDefinition[], targetGrants: PermissionGrant[],
): PermissionEditResourceViewModel[] {
  return manageableResources.map((definition) => {
    const resourceGrants = targetGrants.filter((grant) => grant.resource === definition.resource);
    const isResourceAdmin = resourceGrants.some((grant) => grant.actions.includes('*'));
    const selectedActions = new Set(resourceGrants.flatMap((grant) => grant.actions));
    const selectedScopeValues = new Map<string, Set<string>>();
    for (const grant of resourceGrants) {
      for (const [key, values] of Object.entries(grant.scopes ?? {})) {
        const selected = selectedScopeValues.get(key) ?? new Set<string>();
        values.forEach((value) => selected.add(value));
        selectedScopeValues.set(key, selected);
      }
    }

    return {
      resource: definition.resource,
      label: definition.label,
      hasExistingGrants: resourceGrants.length > 0,
      isResourceAdmin,
      actions: definition.actions.map((action) => ({ value: action.action, label: action.label, checked: selectedActions.has(action.action) })),
      scopes: definition.scopes.map((scope) => ({
        key: scope.key,
        label: scope.label,
        values: scope.values.map((value) => ({
          value: value.value, label: value.label, checked: selectedScopeValues.get(scope.key)?.has(value.value) ?? false,
        })),
      })),
    };
  });
}
