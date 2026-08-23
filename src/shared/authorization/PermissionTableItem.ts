import { PermissionGrant } from './PermissionGrant';
import { logger } from '../../observability/Logger';

// `_subject` is the fixed sk for a medewerker's administrative registration, distinct from `<resource>#<uuid>` grant items in the same partition.
export const SUBJECT_SORT_KEY = '_subject';

export interface PermissionSubject {
  email: string;
  createdAt: string;
  createdBy?: string;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isScopesRecord(value: unknown): value is Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => isStringArray(entry));
}

export function isSubjectItem(item: Record<string, unknown>): boolean {
  return item.sk === SUBJECT_SORT_KEY;
}

/**
 * Turns one raw permissions-table item into a PermissionGrant. An item with a missing resource, invalid actions
 * or invalid scopes is logged and dropped instead of throwing, so one corrupt grant can't break every other read
 * for the same medewerker.
 */
export function toPermissionGrant(item: Record<string, unknown>): PermissionGrant | undefined {
  if (typeof item.resource !== 'string' || item.resource.length === 0) {
    logger.warn('Ignoring permission grant with an invalid resource', { sk: item.sk });
    return undefined;
  }

  if (!isStringArray(item.actions) || item.actions.length === 0) {
    logger.warn('Ignoring permission grant with invalid actions', { sk: item.sk, resource: item.resource });
    return undefined;
  }

  if (item.scopes !== undefined && !isScopesRecord(item.scopes)) {
    logger.warn('Ignoring permission grant with invalid scopes', { sk: item.sk, resource: item.resource });
    return undefined;
  }

  return {
    resource: item.resource,
    actions: item.actions,
    ...(item.scopes ? { scopes: item.scopes as Record<string, string[]> } : {}),
  };
}

/**
 * Turns one raw `_subject` permissions-table item into a PermissionSubject. Same drop-and-log behaviour as
 * toPermissionGrant() for a malformed item.
 */
export function toPermissionSubject(item: Record<string, unknown>): PermissionSubject | undefined {
  if (typeof item.pk !== 'string' || item.pk.length === 0) {
    logger.warn('Ignoring subject item with an invalid pk');
    return undefined;
  }

  if (typeof item.createdAt !== 'string' || item.createdAt.length === 0) {
    logger.warn('Ignoring subject item with an invalid createdAt', { pk: item.pk });
    return undefined;
  }

  return {
    email: item.pk,
    createdAt: item.createdAt,
    ...(typeof item.createdBy === 'string' ? { createdBy: item.createdBy } : {}),
  };
}
