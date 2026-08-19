import { GemeenteNijmegenCdkApp } from '@gemeentenijmegen/projen-project-type';
const project = new GemeenteNijmegenCdkApp({
  cdkVersion: '2.1.0',
  defaultReleaseBranch: 'main',
  devDeps: [
    '@types/aws-lambda',
    'aws-sdk-client-mock',
  ],
  name: 'open-forms-management',
  projenrcTs: true,
  repository: 'https://github.com/GemeenteNijmegen/open-forms-management',
  deps: [
    '@gemeentenijmegen/projen-project-type',
    '@gemeentenijmegen/aws-constructs',
    '@gemeentenijmegen/cross-region-parameters',
    '@aws-lambda-powertools/logger',
    '@aws-lambda-powertools/metrics',
    'openid-client',
    '@gemeentenijmegen/utils',
    '@gemeentenijmegen/session',
    '@gemeentenijmegen/apigateway-http',
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/lib-dynamodb',
  ], /* Runtime dependencies of this module. */
  // description: undefined,  /* The description is just a string that helps people understand the purpose of the package. */
  // packageName: undefined,  /* The "name" in package.json. */
  tsconfig: {
    compilerOptions: {
      isolatedModules: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    },
  },
  eslintOptions: {
    dirs: ['src', 'test', 'build-tools'],
    devdirs: ['test', 'tests', 'build-tools'],
  },
  jestOptions: {
    jestConfig: {
      setupFiles: ['<rootDir>/test/jest.setup.ts'],
    },
  },
});
project.synth();
