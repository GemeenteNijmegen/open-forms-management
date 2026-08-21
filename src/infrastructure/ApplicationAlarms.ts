import { Duration } from 'aws-cdk-lib';
import { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import { Configuration } from '../Configuration';
import { Statics } from '../Statics';

// Powertools Metrics publishes to this namespace without dimensions (see Metrics.ts), so a plain
// namespace/metricName pair is enough to reference a metric emitted from any Lambda in this app.
function applicationMetric(metricName: string): Metric {
  return new Metric({
    namespace: Statics.projectName,
    metricName,
    statistic: 'sum',
    period: Duration.minutes(5),
  });
}

/**
 * Alarms that aren't tied to a single Lambda's error logs: audit write failures, an unusual login
 * failure rate, and API 5xx responses. Per-Lambda error-rate alarms are added at each Lambda's own
 * creation site with `ErrorMonitoringAlarm` instead, so they stay next to the Lambda they monitor.
 */
export function addApplicationAlarms(scope: Construct, api: HttpApi, configuration: Configuration) {
  new Alarm(scope, 'audit-write-failure-alarm', {
    metric: applicationMetric('AuditWriteFailure'),
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    threshold: 0,
    evaluationPeriods: 1,
    alarmName: `audit-write-failure${configuration.criticality.alarmSuffix()}`,
    alarmDescription: 'An audit record failed to write to the AuditTrailTable.',
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });

  // No real ACCP/PROD traffic yet to derive a data-driven threshold from; 10 failures over 15 minutes
  // is a starting point, not a value backed by observed login volume.
  new Alarm(scope, 'login-failure-rate-alarm', {
    metric: applicationMetric('LoginFailure'),
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    threshold: 10,
    evaluationPeriods: 3,
    alarmName: `login-failure-rate${configuration.criticality.alarmSuffix()}`,
    alarmDescription: 'Login failures over a 15 minute window are unusually high.',
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });

  new Alarm(scope, 'api-5xx-alarm', {
    metric: api.metricServerError({ period: Duration.minutes(5) }),
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    threshold: 5,
    evaluationPeriods: 3,
    alarmName: `management-api-5xx${configuration.criticality.alarmSuffix()}`,
    alarmDescription: 'The management HTTP API is returning an unusual number of 5xx responses.',
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });
}
