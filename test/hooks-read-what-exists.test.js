/**
 * @vitest-environment node
 *
 * This file reads source, it does not render it. A jsdom for it costs about
 * twenty-five seconds of wall clock and is never touched.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A hook cannot depend on something declared below it.
 *
 * A dependency array is evaluated while the component renders, so naming a
 * `const` that appears further down the same function throws "Cannot access
 * 'x' before initialization" — in the browser, on a blank screen, with a
 * minified name that says nothing. The bundler does not mind and neither does
 * a build, which is what makes it worth checking here: the failure only ever
 * shows up in front of a user.
 *
 * Only dependency arrays are checked. A `const` named inside a callback body
 * is read later, when the callback runs, and by then everything exists — which
 * is why the ESLint rule for this is unusable on a codebase full of
 * `onClick={() => handleThing()}`.
 */

/*
 * The source, which is now in two places.
 *
 * This file used to sit in `src/test/`, so two `dirname`s reached `src/` and
 * one grep covered the whole application. The tree is a platform now — screens
 * under `apps/`, shared UI under `packages/` — and the same two `dirname`s
 * reach the repository root, where a grep also walks node_modules and dist and
 * reports matches that are not the product.
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/**
 * Where a file that used to be `src/<path>` lives now.
 *
 * The tree became a platform: screens under `apps/accounting/src`, payroll
 * under `apps/payroll/src`, and everything more than one app uses under
 * `packages/ui/src`. A test that reads source has to look in all three, and
 * looking in the wrong one reports a missing file rather than a real result.
 */
const SRC_DIRS = [
  join(ROOT, 'apps/accounting/src'),
  join(ROOT, 'packages/ui/src'),
  join(ROOT, 'apps/payroll/src'),
];
const SRC = SRC_DIRS[0];


const jsxFiles = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...jsxFiles(full));
    else if (/\.jsx?$/.test(name) && !/\.test\.jsx?$/.test(name)) out.push(full);
  }
  return out;
};

/** Where each top-level `const NAME =` first appears in the file. */
const declarationIndex = (source) => {
  const at = new Map();
  const decl = /(?:^|\n)\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/g;
  let m;
  while ((m = decl.exec(source)) !== null) {
    if (!at.has(m[1])) at.set(m[1], m.index);
  }
  return at;
};

/** The file cut at every top-level component or function declaration. */
const componentSlices = (source) => {
  const starts = [];
  const top = /(?:^|\n)(?:export\s+)?(?:default\s+)?(?:const|function)\s+[A-Za-z_$][\w$]*/g;
  let m;
  while ((m = top.exec(source)) !== null) starts.push(m.index);
  if (!starts.length) return [{ source, offset: 0 }];

  return starts.map((start, i) => ({
    source: source.slice(start, starts[i + 1] ?? source.length),
    offset: start,
  }));
};

describe('hook dependencies exist by the time they are read', () => {
  it('no dependency array names a variable declared below it', () => {
    const offenders = [];

    for (const file of jsxFiles(SRC)) {
      const whole = readFileSync(file, 'utf8');
      if (!/use(Memo|Callback|Effect)\(/.test(whole)) continue;

      /*
       * One component at a time. A file holds several, and a name declared in
       * one of them says nothing about a hook in another — checked across the
       * whole file, every second component looks like a violation.
       */
      for (const { source, offset } of componentSlices(whole)) {
      const declaredAt = declarationIndex(source);
      // The closing of a hook call: `}, [a, b.c, d]);`
      const deps = /\}\s*,\s*\[([^\]]*)\]\s*\)/g;
      let m;
      while ((m = deps.exec(source)) !== null) {
        const names = m[1]
          .split(',')
          .map((d) => d.trim().split(/[.?[]/)[0])
          .filter((d) => /^[A-Za-z_$][\w$]*$/.test(d));

        for (const name of names) {
          const declared = declaredAt.get(name);
          if (declared !== undefined && declared > m.index) {
            const line = whole.slice(0, offset + m.index).split('\n').length;
            offenders.push(`${relative(SRC, file)}:${line} depends on ${name}`);
          }
        }
      }
      }
    }

    expect(offenders).toEqual([]);
  });
});
