/**
 * @vitest-environment node
 *
 * Every menu closes when you click somewhere else.
 *
 * Six shipped that did not: the app switcher, both overview period pickers,
 * both overview "more" menus, and the recurring and cash-book row menus. Each
 * had to be dismissed by finding its own trigger and pressing it a second
 * time. Nobody does that — they click elsewhere, nothing happens, and the
 * panel sits over the row they were trying to read.
 *
 * The portalled `Popover` had always handled this, which is why every picker
 * was fine and every hand-rolled `absolute` panel was not. `useDismissable` is
 * now that listener, once; this is what keeps the seventh from being written.
 *
 * The check is deliberately shallow: a floating panel is recognised by its
 * class, and the file is required to use one of the three things that dismiss
 * a panel. A file could still get it wrong — a hook called in the wrong
 * component, a ref on the wrong element — so the real proof of behaviour is
 * useDismissable.test.jsx beside it. What this catches is the pattern being
 * copied to a new screen without any dismissal at all, which is how all six
 * arrived.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const sourceFiles = () =>
  execSync("git ls-files 'apps/**/*.jsx' 'packages/**/*.jsx'", { cwd: root, encoding: 'utf8' })
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => !/\.test\.jsx$/.test(f));

/**
 * A panel that hangs off a control: absolutely positioned, offset from it, and
 * lifted above the page. The three together are what a dropdown looks like —
 * `absolute` alone is every badge and every icon inside a field.
 */
const FLOATING = /className=(?:"|\{`)absolute[^"`]*\b(?:mt-\d|top-full|bottom-full)\b[^"`]*(?:"|`\})/;

/** Anything that knows how to put a panel away. */
const DISMISSES = /useDismissable|<Popover\b|<Modal\b|addEventListener\('pointerdown'|addEventListener\('mousedown'/;

describe('a menu closes when you click away from it', () => {
  it('every floating panel sits in a file that dismisses one', () => {
    const offenders = [];

    for (const file of sourceFiles()) {
      const text = readFileSync(resolve(root, file), 'utf8');
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (!FLOATING.test(line)) return;
        if (DISMISSES.test(text)) return;
        offenders.push(
          `${file}:${i + 1} — a panel anchored to a control, in a file with no dismissal. ` +
            'Use useDismissable(open, () => setOpen(false)) and put its ref on the element ' +
            'that wraps both the trigger and the panel.'
        );
      });
    }

    expect(offenders).toEqual([]);
  });

  it('finds the panels it is supposed to be guarding', () => {
    /* A regex that quietly stops matching turns this file into decoration. */
    const seen = sourceFiles().filter((file) =>
      FLOATING.test(readFileSync(resolve(root, file), 'utf8'))
    );
    expect(seen.length).toBeGreaterThan(4);
    expect(seen).toContain('packages/shell/Shell.jsx');
  });
});
