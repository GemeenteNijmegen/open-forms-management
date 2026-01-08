import { GemeenteNijmegenCdkApp } from '@gemeentenijmegen/projen-project-type';
const project = new GemeenteNijmegenCdkApp({
  cdkVersion: '2.1.0',
  defaultReleaseBranch: 'main',
  projenVersion: '0.98.29',
  devDeps: ['@gemeentenijmegen/projen-project-type'],
  name: 'open-forms-management',
  projenrcTs: true,
  repository: 'https://github.com/GemeenteNijmegen/open-forms-management',
  deps: [
    '@gemeentenijmegen/aws-constructs',
    '@gemeentenijmegen/config',
  ], /* Runtime dependencies of this module. */
  // description: undefined,  /* The description is just a string that helps people understand the purpose of the package. */
  // packageName: undefined,  /* The "name" in package.json. */
  tsconfig: {
    compilerOptions: {
      isolatedModules: true, // Dit versnelt jest tests met >10x. Impact op applicatie is me nog niet helder, dus in een nieuw project veilig(er)?
    },
  },
});
project.synth();
