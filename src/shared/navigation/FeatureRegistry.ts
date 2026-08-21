import { Feature } from './Feature';
import { PermissionEvaluator } from '../authorization/PermissionEvaluator';

export function visibleFeatures(features: Feature[], evaluator: PermissionEvaluator): Feature[] {
  return features.filter((feature) => evaluator.evaluate({ resource: feature.resource, action: feature.action }) === 'ALLOW');
}
