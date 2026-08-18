import { PermissionsBoundaryAspect } from '@gemeentenijmegen/aws-constructs';
import { Aspects, Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AppStack } from './AppStack';
import { Configurable } from './Configuration';
import { UsEastStack } from './UsEastStack';

interface AppStageProps extends StageProps, Configurable { }

export class AppStage extends Stage {

  constructor(scope: Construct, id: string, props: AppStageProps) {
    super(scope, id, props);
    Aspects.of(this).add(new PermissionsBoundaryAspect());

    const usEastStack = new UsEastStack(this, 'us-east-1-stack', {
      env: {
        account: props.configuration.deploymentEnvironment.account,
        region: 'us-east-1',
      },
      configuration: props.configuration,
    });

    const appStack = new AppStack(this, 'app-stack', {
      env: props.configuration.deploymentEnvironment,
      configuration: props.configuration,
    });
    appStack.addDependency(usEastStack);

  }

}