import { PermissionsBoundaryAspect } from '@gemeentenijmegen/aws-constructs';
import { Aspects, SecretValue, Stack, Stage, StageProps, Tags } from 'aws-cdk-lib';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { Configurable } from './Configuration';
import { Statics } from './Statics';

export interface ParameterStageProps extends StageProps, Configurable { }

/**
 * Stage for creating SSM parameters. This needs to run
 * before stages that use them.
 */
export class ParameterStage extends Stage {
  constructor(scope: Construct, id: string, props: ParameterStageProps) {
    super(scope, id, props);
    Tags.of(this).add('cdkManaged', 'yes');
    Tags.of(this).add('Project', Statics.projectName);
    Aspects.of(this).add(new PermissionsBoundaryAspect());
    new ParameterStack(this, 'stack');
  }
}

/**
 * Stack that creates ssm parameters and secrets manager secrets for the
 * application. These need to be present before stacks that use them.
 *
 * All values are safe placeholders. Real values are filled in per
 * environment after the first deployment.
 */
export class ParameterStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    Tags.of(this).add('cdkManaged', 'yes');
    Tags.of(this).add('Project', Statics.projectName);

    this.oidcParameters();
    this.objectsParameters();
    this.openZaakParameters();
  }

  private oidcParameters() {
    new StringParameter(this, 'oidc-issuer', {
      parameterName: Statics.ssmOidcIssuer,
      stringValue: '-',
    });
    new StringParameter(this, 'oidc-client-id', {
      parameterName: Statics.ssmOidcClientId,
      stringValue: '-',
    });
    new Secret(this, 'oidc-client-secret', {
      secretName: Statics.secretOidcClientSecret,
      description: 'Microsoft Entra ID OIDC client secret',
    });
  }

  private objectsParameters() {
    new StringParameter(this, 'objects-base-url', {
      parameterName: Statics.ssmObjectsBaseUrl,
      stringValue: '-',
    });
    new StringParameter(this, 'objects-nijmegenverzoek-objecttype-url', {
      parameterName: Statics.ssmObjectsNijmegenVerzoekObjectTypeUrl,
      stringValue: '-',
    });
    new Secret(this, 'objects-credentials', {
      secretName: Statics.secretObjectsCredentials,
      description: 'Objects API credentials (JSON met apiToken)',
      secretStringValue: SecretValue.unsafePlainText(JSON.stringify({ apiToken: '' })),
    });
  }

  private openZaakParameters() {
    new StringParameter(this, 'open-zaak-documenten-base-url', {
      parameterName: Statics.ssmOpenZaakDocumentenBaseUrl,
      stringValue: '-',
    });
    new Secret(this, 'open-zaak-credentials', {
      secretName: Statics.secretOpenZaakCredentials,
      description: 'Open Zaak credentials (JSON met clientId en clientSecret)',
      secretStringValue: SecretValue.unsafePlainText(JSON.stringify({ clientId: '', clientSecret: '' })),
    });
  }
}