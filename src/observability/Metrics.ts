import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { Statics } from '../Statics';

export const metrics = new Metrics({
  namespace: Statics.projectName,
  serviceName: Statics.projectName,
});

export type MetricName =
  | 'LoginSuccess'
  | 'LoginFailure'
  | 'AuthenticationDenied'
  | 'AccessDenied'
  | 'AuditWriteFailure'
  | 'UnhandledError'
  | 'SessionCreated'
  | 'SessionExpired';

// All eight metrics are occurrence counters without dimensions (see 03-logging-en-audit.md section 12).
export function countMetric(name: MetricName): void {
  metrics.addMetric(name, MetricUnit.Count, 1);
}
