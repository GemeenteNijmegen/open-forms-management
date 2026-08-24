import { PermissionAdministrationPolicy } from './PermissionAdministrationPolicy';
import { PermissionEvaluator } from '../../../shared/authorization/PermissionEvaluator';
import { PermissionGrant } from '../../../shared/authorization/PermissionGrant';
import { PermissionCatalog } from '../catalog/PermissionCatalog';
import { PermissionResourceDefinition } from '../catalog/PermissionResourceDefinition';

export interface PermissionValueViewModel {
  value: string;
  label: string;
}

export interface PermissionScopeViewModel {
  key: string;
  label: string;
  values: PermissionValueViewModel[];
}

export interface PermissionGrantViewModel {
  actions: PermissionValueViewModel[];
  scopes: PermissionScopeViewModel[];
}

export interface PermissionResourceViewModel {
  resource: string;
  label: string;
  grants: PermissionGrantViewModel[];
}

export interface PermissionUserViewModel {
  generalGrants: PermissionGrantViewModel[];
  resources: PermissionResourceViewModel[];
}

const GLOBAL_RESOURCE = '*';
const WILDCARD_ACTION = '*';

/**
 * Turns an actor's authority (via PermissionAdministrationPolicy) and a target's raw grants into what the
 * permissions UI may render: which resource sections an actor may manage, and a security-filtered, catalog-labelled
 * projection of one target's grants. The same projection prefills both the read-only view and the later edit form,
 * so the template never has to know wildcard or resource-isolation logic itself.
 */
export class PermissionAdministrationService {
  constructor(private readonly catalog: PermissionCatalog, private readonly policy: PermissionAdministrationPolicy) { }

  manageableResources(actor: PermissionEvaluator): PermissionResourceDefinition[] {
    return this.catalog.listResources().filter((definition) => this.policy.canManageResource(actor, definition.resource));
  }

  isGlobalAdmin(actor: PermissionEvaluator): boolean {
    return this.policy.canGrantGlobalAdmin(actor);
  }

  projectUser(actor: PermissionEvaluator, targetGrants: PermissionGrant[]): PermissionUserViewModel {
    const isGlobalAdmin = this.policy.canGrantGlobalAdmin(actor);

    const generalGrants = isGlobalAdmin
      ? targetGrants.filter((grant) => grant.resource === GLOBAL_RESOURCE).map((grant) => this.projectGrant(GLOBAL_RESOURCE, grant))
      : [];

    const resources = this.manageableResources(actor).map((definition) => ({
      resource: definition.resource,
      label: definition.label,
      grants: targetGrants
        .filter((grant) => grant.resource === definition.resource)
        .map((grant) => this.projectGrant(definition.resource, grant)),
    }));

    return { generalGrants, resources };
  }

  private projectGrant(resource: string, grant: PermissionGrant): PermissionGrantViewModel {
    if (grant.actions.includes(WILDCARD_ACTION)) {
      /**
       * Resource-admin bypasses scopes in PermissionEvaluator too, so any scopes on this grant are inert; the
       * UI never has to render its own wildcard-means-admin branch.
       */
      const label = resource === GLOBAL_RESOURCE ? 'Superadmin' : `Beheerder van ${this.catalog.resourceLabel(resource)}`;
      return { actions: [{ value: WILDCARD_ACTION, label }], scopes: [] };
    }

    return {
      actions: grant.actions.map((action) => ({ value: action, label: this.catalog.actionLabel(resource, action) })),
      scopes: Object.entries(grant.scopes ?? {}).map(([key, values]) => ({
        key,
        label: this.catalog.scopeLabel(resource, key),
        values: values.map((value) => ({ value, label: this.catalog.scopeValueLabel(resource, key, value) })),
      })),
    };
  }
}
