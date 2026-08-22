export class Statics {

  /**
   * Name of this project
   * Used in PipelineStack and Statics
   */
  static readonly projectName = 'open-forms-management';
  /**
   * Github repository of this project
   * Used in the PipelineStack
   * TODO make sure this is correct
   */
  static readonly githubRepository = `GemeenteNijmegen/${Statics.projectName}`;

  // environments
  static readonly buildEnvironment = {
    account: '836443378780',
    region: 'eu-central-1',
  };

  static readonly gnOpenFormsAccp = {
    account: '043309345347',
    region: 'eu-central-1',
  };

  static readonly gnOpenFormsProd = {
    account: '761018864362',
    region: 'eu-central-1',
  };

  // MARK: account hostedzone
  static readonly accountHostedzonePath = '/gemeente-nijmegen/account/hostedzone';
  static readonly accountHostedzoneName = '/gemeente-nijmegen/account/hostedzone/name';
  static readonly accountHostedzoneId = '/gemeente-nijmegen/account/hostedzone/id';
  static readonly domainPrefix = 'management';

  // MARK: sessions
  static readonly sessionsTableName = `${Statics.projectName}-sessions`;

  // MARK: permissions
  static readonly permissionsTableName = `${Statics.projectName}-permissions`;

  // MARK: audit trail
  static readonly auditTrailTableName = `${Statics.projectName}-audit-trail`;

  // MARK: sport reporter
  static readonly sportReportsTableName = `${Statics.projectName}-sport-reports`;

  // MARK: OIDC (Microsoft Entra ID)
  static readonly ssmOidcIssuer = `/${Statics.projectName}/oidc/issuer`;
  static readonly ssmOidcClientId = `/${Statics.projectName}/oidc/client-id`;
  static readonly secretOidcClientSecret = `/${Statics.projectName}/oidc/client-secret`;

  // MARK: Objects API (alleen configuratie in subproject 1, nog geen client)
  static readonly ssmObjectsBaseUrl = `/${Statics.projectName}/objects/base-url`;
  static readonly ssmObjectsNijmegenVerzoekObjectTypeUrl = `/${Statics.projectName}/objects/nijmegen-verzoek-objecttype-url`;
  /**
   * JSON secret met minimaal `apiToken`.
   */
  static readonly secretObjectsCredentials = `/${Statics.projectName}/objects/credentials`;

  // MARK: Open Zaak Documenten API (alleen configuratie in subproject 1, nog geen client)
  static readonly ssmOpenZaakDocumentenBaseUrl = `/${Statics.projectName}/open-zaak/documenten-base-url`;
  /**
   * JSON secret met `clientId` en `clientSecret`.
   */
  static readonly secretOpenZaakCredentials = `/${Statics.projectName}/open-zaak/credentials`;

  // MARK: UsEastStack producer-outputparameters (us-east-1, alleen door UsEastStack beschreven)
  static readonly ssmUsEastOutputsPath = `/${Statics.projectName}/us-east-1`;
  static readonly ssmManagementCertificateArn = `${Statics.ssmUsEastOutputsPath}/certificate-arn`;
  static readonly ssmManagementWafWebAclArn = `${Statics.ssmUsEastOutputsPath}/waf-web-acl-arn`;

  /**
   * Hosted zone label per branch, without the shared `.csp-nijmegen.nl`
   * suffix (added at the call site, like `cspSubDomain` in mijn-nijmegen).
   */
  static hostedZoneLabel(branchName: string) {
    const hostedZoneLabelMap = {
      test: 'open-forms-accp', // Only used in unit tests
      acceptance: 'open-forms-accp',
      main: 'open-forms-prod',
    };
    const hostedZoneLabel = hostedZoneLabelMap[branchName as keyof typeof hostedZoneLabelMap];
    if (!hostedZoneLabel) {
      throw Error(`No hosted zone configured for branch ${branchName}`);
    }
    return hostedZoneLabel;
  }

}