import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Configurable } from './Configuration';

interface AppStackProps extends StackProps, Configurable { }

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, private readonly props: AppStackProps) {
    super(scope, id, props);

    // TODO add resources here

  }
}