import { PermissionCatalog } from '../catalog/PermissionCatalog';
import { PermissionResourceDefinition } from '../catalog/PermissionResourceDefinition';

/**
 * Deliberately loose: this only rejects obvious garbage. Whether the address belongs to a real medewerker is
 * something Entra/Graph would have to confirm, not this application.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedPermissionGrantRequest {
  targetEmail: string;
  resource: string;
  isResourceAdmin: boolean;
  actions: string[];
  scopes?: Record<string, string[]>;
}

function isValidEmail(value: string | null): value is string {
  return value !== null && EMAIL_PATTERN.test(value.trim());
}

/**
 * Always includes every catalog-defined scope key for the resource, even with an empty value list: omitting a
 * key would mean "unrestricted for this scope dimension" to PermissionEvaluator, which is far more permissive
 * than what a form where nothing got checked should ever produce.
 */
function buildScopes(form: URLSearchParams, resource: PermissionResourceDefinition): Record<string, string[]> | undefined {
  if (resource.scopes.length === 0) {
    return undefined;
  }

  const scopes: Record<string, string[]> = {};
  for (const scopeDefinition of resource.scopes) {
    const submitted = [...new Set(form.getAll(scopeDefinition.key))];
    scopes[scopeDefinition.key] = submitted.filter((value) => scopeDefinition.values.some((allowed) => allowed.value === value));
  }
  return scopes;
}

/**
 * Parses and whitelist-validates one permissionsformulier submission against the catalog. Returns undefined for
 * any structurally invalid or unregistered resource/action/scope instead of throwing, so the caller can render
 * a normal form error. Does not decide whether the actor is *allowed* to grant this — that's
 * PermissionAdministrationPolicy's job, using this parser's output.
 */
export function parsePermissionGrantRequest(form: URLSearchParams, catalog: PermissionCatalog): ParsedPermissionGrantRequest | undefined {
  const targetEmail = form.get('targetEmail');
  if (!isValidEmail(targetEmail)) {
    return undefined;
  }

  const resource = form.get('resource');
  const resourceDefinition = resource ? catalog.getResource(resource) : undefined;
  if (!resource || !resourceDefinition) {
    return undefined;
  }

  const isResourceAdmin = form.get('accessMode') === 'admin';
  if (isResourceAdmin) {
    return { targetEmail: targetEmail.trim(), resource, isResourceAdmin: true, actions: ['*'] };
  }

  const actions = [...new Set(form.getAll('action'))].filter((action) => catalog.isValidAction(resource, action));
  if (actions.length === 0) {
    return undefined;
  }

  return { targetEmail: targetEmail.trim(), resource, isResourceAdmin: false, actions, scopes: buildScopes(form, resourceDefinition) };
}
