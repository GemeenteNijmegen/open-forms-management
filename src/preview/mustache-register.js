'use strict';
const fs = require('fs');

require.extensions['.mustache'] = function (module, filename) {
  const content = fs.readFileSync(filename, 'utf8');
  // TypeScript's __importStar helper wraps this so that X.default === content
  // (same behaviour as the esbuild --loader:.mustache=text used for the deployed Lambdas).
  module.exports = content;
};
