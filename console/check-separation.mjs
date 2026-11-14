// The Console and the customer app are two builds that must not contain each
// other (docs/console/CONSOLE-SPEC.md, criterion 1). This asks the bundler,
// not the eye: it builds each module graph and fails on a file from the wrong
// side. Run after `npm run build` is not needed; it does its own two builds
// in memory and writes nothing.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { build } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const rel = (id) => path.relative(root, id.split('?')[0]).split(path.sep).join('/');

async function modulesOf(configFile) {
  const seen = new Set();
  await build({
    configFile,
    logLevel: 'silent',
    build: { write: false },
    plugins: [{ name: 'collect', moduleParsed: (info) => void (path.isAbsolute(info.id.split('?')[0]) && seen.add(rel(info.id))) }],
  });
  return [...seen].filter((f) => !f.startsWith('node_modules/') && !f.startsWith('..'));
}

const problems = [];
const consoleFiles = await modulesOf(path.join(root, 'console/web/vite.config.js'));
for (const f of consoleFiles) if (f.startsWith('apps/') || f.startsWith('packages/ops/') || f.startsWith('packages/platform/') || f.startsWith('packages/shell/') || f.startsWith('server/')) problems.push(`The Console's bundle contains ${f}`);
if (!consoleFiles.some((f) => f.startsWith('console/web/'))) problems.push('The Console build found none of its own files; this check is not looking at the right build.');

const appFiles = await modulesOf(path.join(root, 'vite.config.js'));
for (const f of appFiles) if (f.startsWith('console/')) problems.push(`The customer bundle contains ${f}`);
if (!appFiles.some((f) => f.startsWith('apps/'))) problems.push('The customer build found no apps/ files; this check is not looking at the right build.');

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Apart: the Console build has ${consoleFiles.length} of its own and shared files, the customer build ${appFiles.length}; neither contains the other.`);
