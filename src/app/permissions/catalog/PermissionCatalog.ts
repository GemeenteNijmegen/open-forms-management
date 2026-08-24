import { PermissionResourceDefinition } from './PermissionResourceDefinition';
import { REGISTERED_PERMISSION_RESOURCES } from './RegisteredPermissionResources';

/**
 * Backend whitelist and label source for permissionsbeheer, in one place: a resource/action/scope is manageable
 * only if it's registered here. Defaults to the real registry; tests can pass a fictional resource list to prove
 * the catalog stays generic across resources with different scope keys.
 */
export class PermissionCatalog {
  constructor(private readonly resources: PermissionResourceDefinition[] = REGISTERED_PERMISSION_RESOURCES) { }

  listResources(): PermissionResourceDefinition[] {
    return this.resources;
  }

  getResource(resource: string): PermissionResourceDefinition | undefined {
    return this.resources.find((definition) => definition.resource === resource);
  }

  isRegisteredResource(resource: string): boolean {
    return this.getResource(resource) !== undefined;
  }

  isValidAction(resource: string, action: string): boolean {
    return this.getResource(resource)?.actions.some((entry) => entry.action === action) ?? false;
  }

  isValidScopeValue(resource: string, scopeKey: string, value: string): boolean {
    return this.getResource(resource)?.scopes
      .find((scope) => scope.key === scopeKey)?.values
      .some((entry) => entry.value === value) ?? false;
  }

  resourceLabel(resource: string): string {
    return this.getResource(resource)?.label ?? resource;
  }

  actionLabel(resource: string, action: string): string {
    return this.getResource(resource)?.actions.find((entry) => entry.action === action)?.label ?? action;
  }

  scopeLabel(resource: string, scopeKey: string): string {
    return this.getResource(resource)?.scopes.find((scope) => scope.key === scopeKey)?.label ?? scopeKey;
  }

  scopeValueLabel(resource: string, scopeKey: string, value: string): string {
    return this.getResource(resource)?.scopes
      .find((scope) => scope.key === scopeKey)?.values
      .find((entry) => entry.value === value)?.label ?? value;
  }
}
