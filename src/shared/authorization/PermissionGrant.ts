export interface PermissionGrant {
  resource: string;
  actions: string[];
  scopes?: Record<string, string[]>;
}
