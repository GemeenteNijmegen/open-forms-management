import { PermissionGrant } from './PermissionGrant';

export interface PermissionCheck {
  resource: string;
  action: string;
  scope?: Record<string, string>;
}

export type PermissionDecision = 'ALLOW' | 'DENY';

const WILDCARD = '*';

export class PermissionEvaluator {
  constructor(private readonly grants: PermissionGrant[]) { }

  evaluate(check: PermissionCheck): PermissionDecision {
    const isGlobalAdmin = this.grants.some((grant) => grant.resource === WILDCARD && grant.actions.includes(WILDCARD));
    if (isGlobalAdmin) {
      return 'ALLOW';
    }

    // Resource admin bypasses scopes, even if another grant scopes the same resource.
    const isResourceAdmin = this.grants.some((grant) => grant.resource === check.resource && grant.actions.includes(WILDCARD));
    if (isResourceAdmin) {
      return 'ALLOW';
    }

    const matchingGrants = this.grants.filter(
      (grant) => grant.resource === check.resource && grant.actions.includes(check.action),
    );

    const allowed = matchingGrants.some((grant) => this.scopeMatches(grant, check));
    return allowed ? 'ALLOW' : 'DENY';
  }

  private scopeMatches(grant: PermissionGrant, check: PermissionCheck): boolean {
    if (!grant.scopes) {
      return true;
    }

    if (!check.scope) {
      // An unscoped check asks whether the grant exists at all, e.g. for feature visibility;
      // the precise scope only matters once the caller checks a concrete scope value.
      return true;
    }

    return Object.entries(grant.scopes).every(([key, allowedValues]) => {
      const requestedValue = check.scope![key];
      // '*' in a scope's allowed values means any value for that key, without granting full resource-admin.
      return requestedValue !== undefined && (allowedValues.includes(WILDCARD) || allowedValues.includes(requestedValue));
    });
  }
}
