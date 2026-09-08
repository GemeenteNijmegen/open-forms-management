import { Feature } from './Feature';
import { PermissionEvaluator } from '../authorization/PermissionEvaluator';

export function visibleFeatures(features: Feature[], evaluator: PermissionEvaluator): Feature[] {
  const allowed = features.filter((feature) => evaluator.evaluate({ resource: feature.resource, action: feature.action }) === 'ALLOW');
  const seenDedupeKeys = new Set<string>();
  return allowed.filter((feature) => {
    if (!feature.dedupeKey) {
      return true;
    }
    if (seenDedupeKeys.has(feature.dedupeKey)) {
      return false;
    }
    seenDedupeKeys.add(feature.dedupeKey);
    return true;
  });
}
