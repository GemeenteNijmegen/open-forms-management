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
    this.keycloakParameters();
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

  private keycloakParameters() {
    new StringParameter(this, 'keycloak-base-url', {
      parameterName: Statics.ssmKeycloakBaseUrl,
      stringValue: '-',
      description: 'Root van de Keycloak-server, met trailing slash, bijvoorbeeld https://keycloak.example.com/',
    });
    new StringParameter(this, 'keycloak-issuer', {
      parameterName: Statics.ssmKeycloakIssuer,
      stringValue: '-',
      description: 'Keycloak realm issuer URL zonder trailing slash, bijvoorbeeld https://keycloak.example.com/realms/open-forms-management. Te vinden via Realm settings > General > OpenID Endpoint Configuration in de Keycloak Admin Console (het issuer-veld)',
    });
    new StringParameter(this, 'keycloak-realm', {
      parameterName: Statics.ssmKeycloakRealm,
      stringValue: '-',
      description: 'Keycloak realm naam, bijvoorbeeld open-forms-management',
    });
    new Secret(this, 'keycloak-oidc-client', {
      secretName: Statics.secretKeycloakOidcClient,
      description: 'Keycloak OIDC client credentials (JSON met clientId en clientSecret), te vinden in Keycloak onder Clients > (client) > Credentials',
      secretStringValue: SecretValue.unsafePlainText(JSON.stringify({ clientId: '', clientSecret: '' })),
    });
    new Secret(this, 'keycloak-permission-admin-client', {
      secretName: Statics.secretKeycloakPermissionAdminClient,
      description: 'Keycloak permission-admin client credentials voor de Admin REST API (JSON met clientId en clientSecret), te vinden in Keycloak onder Clients > (client) > Credentials',
      secretStringValue: SecretValue.unsafePlainText(JSON.stringify({ clientId: '', clientSecret: '' })),
    });
    new Secret(this, 'keycloak-auth-cookie-key', {
      secretName: Statics.secretKeycloakAuthCookieKey,
      description: 'Sleutel voor het versleutelen van de auth-cookie. Niet van Keycloak: zelf genereren met openssl rand -base64 32. Rouleren gebeurt handmatig en logt alle actieve sessies uit.',
    });
  }
}
