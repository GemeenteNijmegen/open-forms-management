import { PermissionsBoundaryAspect } from '@gemeentenijmegen/aws-constructs';
import { Aspects, Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AppStack } from './AppStack';
import { Configurable } from './Configuration';

interface AppStageProps extends StageProps, Configurable { }

/**
 * Main cdk app stage
 * TODO you probably want to rename this stage
 */
export class AppStage extends Stage {

  constructor(scope: Construct, id: string, props: AppStageProps) {
    super(scope, id, props);
    Aspects.of(this).add(new PermissionsBoundaryAspect());

    /**
     * Main stack of this project
     * TODO you probably want to rename this stack
     */
    new AppStack(this, 'app-stack', {
      env: props.configuration.deploymentEnvironment,
      configuration: props.configuration,
    });

  }

}