/**
 * @vitest-environment node
 *
 * `npx` is an installer wearing a runner's clothes.
 *
 * `npx depcruise …` was run in this repository to check the app boundaries.
 * dependency-cruiser was not installed, so npm did what npx does when it
 * cannot find the binary: it went to the registry, found a package publishing
 * a `depcruise` bin, downloaded it and ran it. The package was a placeholder —
 * somebody's claim on a name a tool is commonly invoked by — and it ran with
 * the full rights of the person typing. That is dependency confusion, and it
 * arrives through a command that looks like it only runs local things.
 *
 * The rule, then:
 *
 *   Every tool this project runs is a declared dependency, installed from the
 *   committed lockfile. Nothing is fetched at the moment it is used.
 *
 * `npx <bin>` is allowed only where `<bin>` comes from a package in
 * package.json — then npx resolves it from node_modules and reaches no
 * network. This test is what keeps that true: adding `npx something-new` to a
 * script, a deploy or a Dockerfile fails here until the package it comes from
 * is declared.
 *
 * It also keeps a map of which package each binary belongs to, because the two
 * names are often different — and the gap between them is exactly where a
 * squatter sits. `depcruise` is not a package. `dependency-cruiser` is.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Binary → the package that publishes it.
 *
 * Deliberately a written list rather than something read out of node_modules:
 * the point is that a human decided this binary comes from this package. A
 * lookup through whatever happens to be installed would have cheerfully
 * confirmed that `depcruise` comes from the squatter's package, because by
 * then it was installed.
 */
const BIN_PACKAGE = {
  depcruise: 'dependency-cruiser',
  eslint: 'eslint',
  prisma: 'prisma',
  tsc: 'typescript',
  tsx: 'tsx',
  vite: 'vite',
  vitest: 'vitest',
};

const manifests = ['package.json', 'server/package.json'].map((rel) => {
  const json = JSON.parse(readFileSync(resolve(root, rel), 'utf8'));
  return { rel, deps: { ...(json.dependencies || {}), ...(json.devDependencies || {}) } };
});

/** Declared anywhere this repository installs from — root, or the API. */
const declaredIn = (pkg) => manifests.filter((m) => m.deps[pkg]).map((m) => m.rel);

/*
 * Every file that can run a command, as git knows them.
 *
 * Tracked files only: a worktree under .claude, a stray copy in a backup
 * folder and anything inside node_modules are not this project's instructions
 * to itself, and failing on them teaches people to add exclusions rather than
 * to fix the real thing.
 */
const commandFiles = () =>
  execSync(
    "git ls-files '*.sh' '*.yml' '*.yaml' 'package.json' 'server/package.json' 'docker/*' '.github/workflows/*'",
    { cwd: root, encoding: 'utf8' }
  )
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);

/** Every `npx <bin>` that is a command rather than a sentence about one. */
const invocations = () => {
  const out = [];
  for (const file of commandFiles()) {
    const lines = readFileSync(resolve(root, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      /* A comment explaining what to run is prose, not a command. The scripts
         here document their own steps that way, and a documented step is
         caught anyway on the line that actually runs it. */
      const code = line.replace(/^\s*[#*]+.*$/, '');
      for (const m of code.matchAll(/\bnpx\s+(?:--[\w-]+(?:[= ]\S+)?\s+)*([@\w][\w./-]*)/g)) {
        out.push({ file, line: i + 1, bin: m[1], text: line.trim() });
      }
    });
  }
  return out;
};

describe('npx never reaches the registry', () => {
  it('runs only binaries this project depends on', () => {
    const strangers = [];

    for (const use of invocations()) {
      const pkg = BIN_PACKAGE[use.bin];
      if (!pkg) {
        strangers.push(
          `${use.file}:${use.line} — \`npx ${use.bin}\` is not in BIN_PACKAGE. ` +
            'Add the package it comes from to package.json and name it in the map, ' +
            'or npm will fetch whoever has published that name.'
        );
        continue;
      }
      if (!declaredIn(pkg).length) {
        strangers.push(
          `${use.file}:${use.line} — \`npx ${use.bin}\` needs "${pkg}", which no package.json declares. ` +
            'npx would download it at the moment of use.'
        );
      }
    }

    expect(strangers).toEqual([]);
  });

  it('has a map that still describes reality', () => {
    /* A mapping that names a package nobody installs is a line that will be
       believed later. Removing the dependency has to remove the entry. */
    const orphans = Object.entries(BIN_PACKAGE)
      .filter(([, pkg]) => !declaredIn(pkg).length)
      .map(([bin, pkg]) => `${bin} → ${pkg} (not in any package.json)`);

    expect(orphans).toEqual([]);
  });

  it('finds the invocations it is supposed to be guarding', () => {
    /* A regex that silently stops matching turns this file into decoration.
       The deploy builds the frontend with npx; if that is not seen, nothing
       else is either. */
    const found = invocations();
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((u) => u.file === 'deploy.sh' && u.bin === 'vite')).toBe(true);
  });
});
