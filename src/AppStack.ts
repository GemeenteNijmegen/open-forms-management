import { ConfigTable } from '@gemeentenijmegen/config';
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Configurable } from './Configuration';
import { HomeFunction } from './home/home-function';

interface AppStackProps extends StackProps, Configurable { }

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, private readonly props: AppStackProps) {
    super(scope, id, props);

    new ConfigTable(this, 'config', {
      config: {
        someKey: 'somevalue',
      },
    });
    new HomeFunction(this, 'home-function');
  }
}
