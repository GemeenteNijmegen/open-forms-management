import { Criticality } from '@gemeentenijmegen/aws-constructs';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AppStack } from '../AppStack';
import { AppStage } from '../AppStage';
import { UsEastStack } from '../UsEastStack';

describe('AppStage', () => {
  const configuration = {
    branchName: 'test',
    buildEnvironment: { account: '123456789012', region: 'eu-central-1' },
    deploymentEnvironment: { account: '123456789012', region: 'eu-central-1' },
    criticality: new Criticality('low'),
    logLevel: 'DEBUG' as const,
  };

  const stage = new AppStage(new App(), 'TestAppStage', { configuration });
  const usEastStack = stage.node.findChild('us-east-1-stack') as UsEastStack;
  const appStack = stage.node.findChild('app-stack') as AppStack;

  it('deploys UsEastStack in us-east-1', () => {
    expect(usEastStack.region).toBe('us-east-1');
    expect(usEastStack.account).toBe('123456789012');
  });

  it('deploys AppStack in the normal deployment region', () => {
    expect(appStack.region).toBe('eu-central-1');
    expect(appStack.account).toBe('123456789012');
  });

  it('makes AppStack explicitly depend on UsEastStack', () => {
    expect(appStack.dependencies).toContain(usEastStack);
  });

  it('does not use CloudFormation cross-region export/import between the stacks', () => {
    const appStackTemplate = JSON.stringify(Template.fromStack(appStack).toJSON());
    expect(appStackTemplate).not.toContain('Fn::ImportValue');

    const usEastStackTemplate = JSON.stringify(Template.fromStack(usEastStack).toJSON());
    expect(usEastStackTemplate).not.toContain('Fn::ImportValue');
  });
});
