import { PermissionsBoundaryAspect } from '@gemeentenijmegen/aws-constructs';
import { Aspects, Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AppStack } from './AppStack';
import { Configurable } from './Configuration';

interface AppStageProps extends StageProps, Configurable { }

export class AppStage extends Stage {

  constructor(scope: Construct, id: string, props: AppStageProps) {
    super(scope, id, props);
    Aspects.of(this).add(new PermissionsBoundaryAspect());

    new AppStack(this, 'app-stack', {
      env: props.configuration.deploymentEnvironment,
      configuration: props.configuration,
    });

  }

}