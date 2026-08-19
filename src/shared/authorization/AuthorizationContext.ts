import { PermissionEvaluator } from './PermissionEvaluator';
import { EmployeeIdentity } from '../auth/EmployeeIdentity';

export interface AuthorizationContext {
  identity: EmployeeIdentity;
  evaluator: PermissionEvaluator;
}
