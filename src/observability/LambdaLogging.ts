import { RemovalPolicy } from 'aws-cdk-lib';
import { Function } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { Configuration } from '../Configuration';
import { Statics } from '../Statics';

/**
 * Applies the standard logging environment (Powertools log level and service
 * name) to a Lambda function. Every Lambda in this app gets this so logging
 * behaves the same everywhere without repeating the environment variables
 * at each call site.
 *
 * Takes the concrete Function, not IFunction: addEnvironment is only
 * available on Lambdas this app actually owns, not on imported references.
 */
export function applyLambdaLoggingDefaults(fn: Function, configuration: Configuration) {
  fn.addEnvironment('POWERTOOLS_LOG_LEVEL', configuration.logLevel);
  fn.addEnvironment('POWERTOOLS_SERVICE_NAME', Statics.projectName);
}

/**
 * Creates the LogGroup for a Lambda function up front (passed in as the
 * `logGroup` prop), so it has a fixed retention instead of CloudWatch's
 * default of never expiring. Alarms can later target this LogGroup directly.
 */
export function createLambdaLogGroup(scope: Construct, id: string): LogGroup {
  return new LogGroup(scope, `${id}-log-group`, {
    retention: RetentionDays.ONE_MONTH,
    removalPolicy: RemovalPolicy.DESTROY,
  });
}
