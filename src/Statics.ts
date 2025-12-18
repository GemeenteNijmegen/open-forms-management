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

  static readonly ssmDummyParameter = `/${Statics.projectName}/dummy/parameter`;

  // MARK: environments
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

}