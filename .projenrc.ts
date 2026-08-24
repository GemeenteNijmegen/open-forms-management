import { GemeenteNijmegenCdkApp } from '@gemeentenijmegen/projen-project-type';
import { Transform } from 'projen/lib/javascript';

const project = new GemeenteNijmegenCdkApp({
  cdkVersion: '2.1.0',
  defaultReleaseBranch: 'main',
  name: 'open-forms-management',
  projenrcTs: true,
  repository: 'https://github.com/GemeenteNijmegen/open-forms-management',
  deps: [
    '@gemeentenijmegen/projen-project-type',
    '@gemeentenijmegen/aws-constructs',
    '@gemeentenijmegen/cross-region-parameters',
    '@gemeentenijmegen/utils',
    '@gemeentenijmegen/session',
    '@gemeentenijmegen/apigateway-http',
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/lib-dynamodb',
    '@aws-sdk/client-lambda',
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
    '@aws-lambda-powertools/logger',
    '@aws-lambda-powertools/metrics',
    // Widely used file watcher with a small runtime dependency tree and no install lifecycle scripts.
    'chokidar',
    // Mature zero-dependency template renderer with no install lifecycle scripts; deliberately kept simple for server-rendered HTML.
    'mustache',
    // Widely used, actively maintained OIDC/OAuth client with a small dependency tree, security policy and no install lifecycle scripts.
    'openid-client',
    // Widely used TypeScript validation library with no runtime dependencies or install lifecycle scripts.
    'zod',
    // Mature, actively maintained CSV parser with zero runtime dependencies and no install lifecycle scripts.
    'csv-parse',
    // Small XLSX writer with minimal runtime dependencies and no pre/postinstall scripts; preferred over heavier Excel libraries.
    'write-excel-file',
  ],
  devDeps: [
    '@types/aws-lambda',
    '@types/mustache',
    'aws-sdk-client-mock',
    'esbuild',
    '@gemeentenijmegen/design-tokens',
    '@gemeentenijmegen/layout-css',
    '@gemeentenijmegen/components-css',
    '@gemeentenijmegen/semantic-html',
    '@gemeentenijmegen/web-components',
    '@utrecht/document-css@1.5.0',
    '@utrecht/alert-css@4.0.2',
    '@utrecht/button-css@2.3.0',
    '@utrecht/button-group-css@1.4.0',
    '@utrecht/paragraph-css@2.3.1',
    '@utrecht/heading-1-css@1.5.0',
    '@utrecht/heading-2-css@1.5.0',
    '@utrecht/heading-3-css@1.5.0',
    '@utrecht/heading-4-css@1.5.0',
    '@utrecht/heading-5-css@1.5.0',
    '@utrecht/heading-6-css@1.5.0',
    '@utrecht/page-body-css',
    '@utrecht/rich-text-css',
    '@utrecht/pre-heading-css',
    '@utrecht/link-css@1.6.0',
    '@utrecht/form-field-css@3.0.1',
    '@utrecht/form-label-css@3.0.1',
    '@utrecht/textbox-css@4.0.1',
    '@utrecht/form-field-description-css@3.0.1',
    '@utrecht/form-field-error-message-css@3.0.1',
  ],
  tsconfig: {
    compilerOptions: {
      isolatedModules: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    },
  },
  eslintOptions: {
    dirs: ['src', 'test'],
    devdirs: ['test', 'tests'],
  },
  bundlerOptions: {
    loaders: {
      mustache: 'text',
    },
  },
  jestOptions: {
    jestConfig: {
      setupFiles: ['<rootDir>/test/jest.setup.ts'],
      moduleFileExtensions: ['js', 'json', 'jsx', 'ts', 'tsx', 'node', 'mustache'],
      transform: {
        '^.+\\.[t]sx?$': new Transform('ts-jest', { tsconfig: 'test/tsconfig.json' }),
        '^.+\\.mustache$': new Transform('<rootDir>/test/mustache-transform.js'),
      },
    },
  },
  gitignore: [
    '/preview/',
    'src/app/static-resources/static/styles/ds.*',
    'src/app/static-resources/static/js/web-components/',
  ],
});

// mustache-register.js lets ts-node require .mustache files directly, the same way esbuild's
// --loader:.mustache=text does for the deployed Lambda bundles.
const previewCmd = 'ts-node -P tsconfig.json --transpile-only -r ./src/preview/mustache-register.js';

project.addTask('preview', {
  exec: `${previewCmd} ./src/preview/render-previews.ts`,
  description: 'Render preview HTML for all pages once',
});

project.addTask('preview:watch', {
  exec: `${previewCmd} ./src/preview/watch.ts`,
  description: 'Watch templates and re-render preview HTML on changes',
});

// esbuild warns about 2 malformed CSS custom properties in @gemeentenijmegen/design-tokens
// (--ams-time-input-*: escaped quotes inside url(), one value literally "[object Object]").
// Upstream bug in a vendor package, not ours to fix. We don't use time-input anywhere, harmless.
const cssBundleTask = project.addTask('bundle:css-bundle', {
  exec: [
    'esbuild ./src/app/static-resources/static/styles/ds-input.js',
    '--bundle',
    '--target=node22',
    '--platform=node',
    '--outfile=./src/app/static-resources/static/styles/ds.js',
    '--loader:.css=css',
    '--loader:.mustache=text',
    '--loader:.woff2=file',
    '--loader:.woff=file',
    '--loader:.ttf=file',
    '--asset-names=[name]',
    '--sourcemap',
  ].join(' '),
  description: 'Bundle design system CSS into ds.css',
});
project.compileTask.spawn(cssBundleTask);

const copyWcTask = project.addTask('bundle:copy-web-components', {
  description: 'Copy NLDS web component IIFE bundles to static/js/web-components/, stripping CSS injection for CSP compliance',
  exec: 'node scripts/strip-web-component-css.mjs',
});
project.compileTask.spawn(copyWcTask);

// cfn-lint's bundled IAM action spec is missing dynamodb:TransactWriteItems (W3037 false positive),
// used for the atomic replace/remove writes in PermissionsRoute.ts. Same known gap as
// https://github.com/aws-cloudformation/cfn-lint/issues/4035.
project.tasks.tryFind('cfn-lint')?.reset('cfn-lint cdk.out/**/*.template.json -i W3005 W2001 W3037');

project.synth();
