import { Criticality } from '@gemeentenijmegen/aws-constructs';
import { Environment } from 'aws-cdk-lib';
import { Statics } from './Statics';

/**
 * Adds a configuration field to another interface
 */
export interface Configurable {
  configuration: Configuration;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * Basic configuration options per environment
 */
export interface Configuration {
  /**
   * Branch name for the applicible branch (this branch)
   */
  branchName: string;

  /**
   * The pipeline will run from this environment
   *
   * Use this environment for your initial manual deploy
   */
  buildEnvironment: Required<Environment>;

  /**
   * Environment to deploy the application to
   *
   * The pipeline (which usually runs in the build account) will
   * deploy the application to this environment. This is usually
   * the workload AWS account in our default region.
   */
  deploymentEnvironment: Required<Environment>;

  /**
   * Base criticality for monitoring deployed for this branch.
   */
  criticality: Criticality;

  /**
   * POWERTOOLS_LOG_LEVEL for all Lambda's deployed for this branch.
   */
  logLevel: LogLevel;

  /**
   * Whether the Route53 healthcheck on /login is created for this branch.
   */
  loginHealthCheckEnabled: boolean;

}

const configurations: Configuration[] = [
  {
    branchName: 'acceptance',
    buildEnvironment: Statics.buildEnvironment,
    deploymentEnvironment: Statics.gnOpenFormsAccp,
    criticality: new Criticality('medium'),
    logLevel: 'DEBUG',
    loginHealthCheckEnabled: true,
  },
  {
    branchName: 'main',
    buildEnvironment: Statics.buildEnvironment,
    deploymentEnvironment: Statics.gnOpenFormsProd,
    criticality: new Criticality('high'),
    logLevel: 'INFO',
    loginHealthCheckEnabled: true,
  },
];

/**
 * Retrieve a configuration object by passing a branch string
 *
 * **NB**: This retrieves the subobject with key `branchName`, not
 * the subobject containing the `branchName` as the value of the `branch` key
 *
 * @param branchName the branch for which to retrieve the environment
 * @returns the configuration object for this branch
 */
export function getConfiguration(branchName: string): Configuration {
  const config = configurations.find((configuration) => configuration.branchName == branchName);
  if (!config) {
    throw Error(`No configuration found for branch name ${branchName}`);
  }
  return config;
}

/**
 * Based on the environment find the branch to build.
 * Options are in decreasing priority:
 * 1. BRANCH_NAME (set in AWS builds)
 * 2. GITHUB_BASE_REF (set in github PR workflow executions)
 * 3. defaultBranchToBuild that is provided as a parameter
 */
export function getBranchToBuild(defaultBranchToBuild: string) {

  const branchOptions = configurations.map(config => config.branchName);
  const githubBaseBranchName = process.env.GITHUB_BASE_REF;
  const environmentBranchName = process.env.BRANCH_NAME;

  // Low priority keep branch undefined
  let build = defaultBranchToBuild;

  // Midium priority branch name is set by github and is a valid option
  if (githubBaseBranchName && branchOptions.includes(githubBaseBranchName)) {
    build = githubBaseBranchName;
  }

  // High priority if BRANCH_NAME env variable is set use it
  build = environmentBranchName ?? build;

  return build;
}