export interface PermissionValueDefinition {
  value: string;
  label: string;
}

export interface PermissionScopeDefinition {
  key: string;
  label: string;
  values: PermissionValueDefinition[];
}

export interface PermissionActionDefinition {
  action: string;
  label: string;
}

/**
 * The wildcard action is system semantics for resource-admin (see PermissionEvaluator), not a resource-specific
 * action, so it is never registered here as one of the actions.
 */
export interface PermissionResourceDefinition {
  resource: string;
  label: string;
  actions: PermissionActionDefinition[];
  scopes: PermissionScopeDefinition[];
}
