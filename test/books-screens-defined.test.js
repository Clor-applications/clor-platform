import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every component Books' screen switch renders must exist (found 16 Nov 2026).
 *
 * The 15 Nov Books port removed the Trial Balance component but left the
 * `financials` screen rendering it, so the screen threw "TrialBalance is not
 * defined" in production — and, because Books' rail sat inside the same
 * boundary, every screen opened after it failed too. Lint does not catch a JSX
 * name that is never declared inside a large memo, so this reads the switch.
 */
const app = readFileSync('apps/accounting/src/App.jsx', 'utf8');

describe('Books screens', () => {
  it('renders only components that are imported or declared', () => {
    const start = app.indexOf('const page = useMemo(() => {');
    const end = app.indexOf('\n  }, [active,', start);
    expect(start).toBeGreaterThan(-1);
    const body = app.slice(start, end);
    const used = new Set([...body.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)].map((m) => m[1]));
    const declared = (name) =>
      new RegExp(`(?:import\\s+${name}\\b|import\\s+(?:\\w+\\s*,\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}|(?:const|function|class)\\s+${name}\\b|\\bas\\s+${name}\\b)`).test(app);
    const missing = [...used].filter((n) => !declared(n));
    expect(missing).toEqual([]);
  });

  it('keeps a per-screen error boundary inside Books, reset by the open screen', () => {
    expect(app).toMatch(/<ScreenErrorBoundary resetKey=\{active\}>/);
  });
});
