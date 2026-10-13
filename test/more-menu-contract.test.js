/**
 * @vitest-environment node
 *
 * The More menu hands back a key. It does not call a callback on the item.
 *
 * `MoreButton` renders `items` and, on a click, calls `onSelect(item.key)` —
 * the handler the shell was given as `onMoreSelect`. It never looks at the
 * item for a function. So an item written as `{ key, label, onSelect() {} }`
 * with no `onMoreSelect` on the shell is not a slightly different style: the
 * menu closes, `onSelect` is undefined, and the click does nothing. That is
 * how "Difference adjustment ledger…" sat dead on Bank & Cash Accounts.
 *
 * Two rules, both cheap to read off the source:
 *   - a shell given `moreItems` is also given `onMoreSelect`
 *   - no item inside a `moreItems` array carries its own `onSelect`
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const sources = () =>
  execSync("git ls-files 'apps/**/*.jsx' 'packages/**/*.jsx'", { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((f) => ({ file: relative(root, f), text: readFileSync(resolve(root, f), 'utf8') }));

/* The props of one JSX element, from `<DocumentListShell` to the `>` that
   closes its opening tag — `>` inside a brace expression does not end it. */
const shellProps = (text) => {
  const out = [];
  for (const m of text.matchAll(/<DocumentListShell\b/g)) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < text.length; i += 1) {
      const c = text[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
    }
    out.push(text.slice(m.index, i));
  }
  return out;
};

describe('the More menu contract', () => {
  it('pairs every moreItems with an onMoreSelect', () => {
    const broken = [];
    for (const { file, text } of sources()) {
      for (const props of shellProps(text)) {
        if (!/\bmoreItems=/.test(props)) continue;
        if (/\bonMoreSelect=/.test(props)) continue;
        broken.push(file);
      }
    }
    expect(broken).toEqual([]);
  });

  it('never hangs an onSelect off a menu item', () => {
    const broken = [];
    for (const { file, text } of sources()) {
      for (const props of shellProps(text)) {
        const items = props.match(/moreItems=\{[\s\S]*?\n\s{6}\w/);
        if (!items) continue;
        if (/\bonSelect:\s*(\(|async|function)/.test(items[0])) broken.push(file);
      }
    }
    expect(broken).toEqual([]);
  });

  /* Guards both assertions against passing on an empty search. */
  it('finds the shells to check', () => {
    const withMenus = sources().flatMap(({ text }) => shellProps(text)).filter((p) => /\bmoreItems=/.test(p));
    expect(withMenus.length).toBeGreaterThan(5);
  });
});
