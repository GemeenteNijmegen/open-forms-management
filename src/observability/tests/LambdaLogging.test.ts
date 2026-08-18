import { Criticality } from '@gemeentenijmegen/aws-constructs';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Statics } from '../../Statics';
import { applyLambdaLoggingDefaults } from '../LambdaLogging';

describe('applyLambdaLoggingDefaults', () => {
  it('sets POWERTOOLS_LOG_LEVEL from the configuration and POWERTOOLS_SERVICE_NAME', () => {
    const stack = new Stack(new App(), 'TestStack');
    const fn = new Function(stack, 'fn', {
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => {};'),
    });

    applyLambdaLoggingDefaults(fn, {
      branchName: 'test',
      buildEnvironment: { account: '123456789012', region: 'eu-central-1' },
      deploymentEnvironment: { account: '123456789012', region: 'eu-central-1' },
      criticality: new Criticality('low'),
      logLevel: 'DEBUG',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          POWERTOOLS_LOG_LEVEL: 'DEBUG',
          POWERTOOLS_SERVICE_NAME: Statics.projectName,
        }),
      }),
    }));
  });
});
