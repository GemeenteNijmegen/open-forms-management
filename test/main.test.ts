import { Criticality } from '@gemeentenijmegen/aws-constructs';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AppStack } from '../src/AppStack';
import { PipelineStack } from '../src/PipelineStack';

describe('AppStack', () => {
  let stack: Stack;
  const config = { branchName: 'test', buildEnvironment: { account: '123456789012', region: 'eu-central-1' }, deploymentEnvironment: { account: '123456789012', region: 'eu-central-1' }, criticality: new Criticality('low'), logLevel: 'DEBUG' as const };

  beforeEach(() => {
    stack = new AppStack(new App(), 'TestStack', { configuration: config });
  });

  it('should create a stack', () => {
    expect(stack).toBeDefined();
  });
});

describe('PipelineStack', () => {
  let stack: Stack;
  const config = { branchName: 'test', buildEnvironment: { account: '123456789012', region: 'eu-central-1' }, deploymentEnvironment: { account: '123456789012', region: 'eu-central-1' }, criticality: new Criticality('low'), logLevel: 'DEBUG' as const };

  beforeEach(() => {
    stack = new PipelineStack(new App(), 'TestPipelineStack', {
      env: { account: '123456789012', region: 'eu-central-1' },
      configuration: config,
    });
  });

  it('should create a stack', () => {
    expect(stack).toBeDefined();
  });

  it('should match the snapshot', () => {
    const template = Template.fromStack(stack);
    expect(template.toJSON()).toMatchSnapshot();
  });
});
