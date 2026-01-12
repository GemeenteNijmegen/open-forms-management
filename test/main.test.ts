import { Criticality } from '@gemeentenijmegen/aws-constructs';
import { Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AppStack } from '../src/AppStack';
import { PipelineStack } from '../src/PipelineStack';

describe('AppStack', () => {
  let stack: Stack;
  const config = { branchName: 'test', buildEnvironment: { account: 'test', region: 'eu-central-1' }, deploymentEnvironment: { account: 'test', region: 'eu-central-1' }, criticality: new Criticality('low') };

  beforeEach(() => {
    stack = new AppStack(new Stack(), 'TestStack', { configuration: config });
  });

  it('should create a stack', () => {
    expect(stack).toBeDefined();
  });

  it('should have a ConfigTable resource', () => {
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    const tables = template.findResources('AWS::DynamoDB::Table');
    expect(Object.values(tables)).toMatchSnapshot();
  });
});

describe('PipelineStack', () => {
  let stack: Stack;
  const config = { branchName: 'test', buildEnvironment: { account: 'test', region: 'eu-central-1' }, deploymentEnvironment: { account: 'test', region: 'eu-central-1' }, criticality: new Criticality('low') };

  beforeEach(() => {
    stack = new PipelineStack(new Stack(), 'TestPipelineStack', {
      env: { account: 'test', region: 'eu-central-1' },
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
