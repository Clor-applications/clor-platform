/**
 * Where `@ui` and `@platform` point, for tools that are not Vite.
 *
 * dependency-cruiser resolves imports for itself, and without these aliases
 * every `@ui/...` is unresolvable — so a boundary rule cannot see half the
 * graph, and the check passes while the boundary is being crossed. Vite reads
 * its own copy in vite.config.js; this file exists so the two cannot be the
 * only place the mapping is written down without anybody noticing they differ.
 */
const { resolve } = require('node:path');

module.exports = {
  resolve: {
    alias: {
      '@ui': resolve(__dirname, 'packages/ui/src'),
      '@platform': resolve(__dirname, 'packages/platform'),
    },
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
  },
};
