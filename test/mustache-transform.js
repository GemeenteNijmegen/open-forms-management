// Jest transform for .mustache files: exports the raw file content as a string, mirroring esbuild's
// --loader:.mustache=text bundling behaviour so tests see the same content shape as the deployed Lambda.
module.exports = {
  process(content) {
    return { code: `module.exports = ${JSON.stringify(content)}` };
  },
};
