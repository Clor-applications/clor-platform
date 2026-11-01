import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * People in deep indigo (owner, 2 Nov 2026, direction A of three, after "too pale, washed out" and "generic"). The
 * bar, rail and module panel are the brand's indigo, the work area stays white, and colour comes in solid blocks.
 * The design note: DESIGN.md, Color → People (brand D) → Deep indigo frame.
 */
const read = (f) => readFileSync(f, 'utf8');
const people = read('packages/ui/src/people.css');
const block = people.slice(people.indexOf('Deep indigo (owner, 2 Nov 2026'), people.indexOf('The employee app (shared with Attendance'));
const token = (src, name) => (src.match(new RegExp(`--${name}:\\s*([\\d ]+);`)) || [])[1]?.trim();

const lum = (rgb) => {
  const c = rgb.split(' ').map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const WHITE = '255 255 255';
const INDIGO = '35 42 102';
const MARIGOLD = '245 166 35';
const LILAC = '233 229 244';
const COTTON = '250 246 238';

const frame = token(block, 'frame');
const panel = token(block, 'frame-panel');
const hi = token(block, 'frame-hi');
const onFrame = token(block, 'on-frame');
const onMuted = token(block, 'on-frame-muted');

describe('the frame is indigo, and every word on it reads', () => {
  it('defines the frame tokens once, in the light sky palette', () => {
    expect(block).toMatch(/^:root\[data-palette='sky'\]:not\(\[data-theme='dark'\]\),\n:root:not\(\[data-theme='dark'\]\) \[data-palette='sky'\] \{\n\s*--frame: 27 33 82;/m);
    expect(panel).toBe(INDIGO);
    for (const t of [frame, panel, hi, onFrame, onMuted]) expect(t).toMatch(/^\d+ \d+ \d+$/);
  });

  it('the frame stands apart from the white work area (was 1.08:1)', () => {
    expect(contrast(frame, WHITE)).toBeGreaterThan(12);
    expect(contrast(panel, WHITE)).toBeGreaterThan(12);
  });

  it('labels, group names and menu words clear AA on the bar, the panel and a hovered row', () => {
    for (const ground of [frame, panel]) {
      expect(contrast(onFrame, ground)).toBeGreaterThan(7);
      expect(contrast(onMuted, ground)).toBeGreaterThan(7);
    }
    expect(contrast(onMuted, hi)).toBeGreaterThan(4.5);
    expect(contrast(WHITE, hi)).toBeGreaterThan(7);
  });

  it('the open screen is a lilac tile that reads against the indigo panel (was 1.14:1), with indigo words', () => {
    expect(contrast(LILAC, panel)).toBeGreaterThan(7);
    expect(contrast(INDIGO, LILAC)).toBeGreaterThan(7);
    expect(block).toMatch(/\.ui-split-panel \.ui-split-item\[aria-current='page'\] \{\n\s*background: rgb\(var\(--lilac\)\); color: rgb\(var\(--indigo\)\);[^}]*inset 3px 0 0 rgb\(var\(--marigold\)\)/);
  });

  it('marigold on the frame is a fill or a mark: the open module and the waiting tile, indigo words on it', () => {
    expect(contrast(MARIGOLD, frame)).toBeGreaterThan(3);
    expect(contrast(INDIGO, MARIGOLD)).toBeGreaterThan(4.5);
    expect(block).toMatch(/\.ui-split-rail \.ui-split-mod\[data-current\] \.ui-glyph \[opacity='0\.2'\] \{ fill: rgb\(var\(--marigold\)\); \}/);
    expect(block).toMatch(/\.soft-band-stat\[data-attention\] \{ background: rgb\(var\(--marigold\)\); \}/);
    expect(read('apps/people/src/screens/PeopleOverview.jsx')).toContain('data-attention={waiting > 0 || undefined}');
  });

  it('the work area keeps readable support text and a firmer row line', () => {
    expect(contrast(token(block, 'fg-muted'), WHITE)).toBeGreaterThan(7);
    expect(contrast(INDIGO, token(block, 'heading-bg'))).toBeGreaterThan(7);
    expect(contrast(token(block, 'border'), WHITE)).toBeGreaterThan(1.26);
  });

  it('the frame redefines the shared tokens, so the bar, picker and search follow; menus from the bar return to light', () => {
    expect(block).toMatch(/:is\(\.ui-topbar, \.ui-split-rail, \.ui-split-panel\) \{\n\s*--surface: var\(--frame-panel\);/);
    expect(block).toMatch(/\.ui-topbar :is\(\.ui-popover, \[role='menu'\], \[role='dialog'\], \[role='listbox'\]\) \{\n\s*--surface: 255 255 255;/);
  });

  it('stays in People: every rule of the block is on the light sky palette', () => {
    const rules = block.split('\n').filter((l) => /\{\s*$|\{ .*\}$/.test(l) && !l.trim().startsWith('/*') && !l.includes('@media'));
    expect(rules.length).toBeGreaterThan(40);
    for (const l of rules) expect(l, l).toMatch(/data-palette='sky'\]|^\s+--|^\s+[a-z-]+:/);
    expect(block).not.toMatch(/data-app=/);
  });

  it('the superseded Cotton rail and pale lilac panel are gone', () => {
    expect(people).not.toMatch(/:is\(\.ui-split-rail, \.ui-split-panel\) \{ background: rgb\(250 246 238\); \}/);
    expect(people).not.toMatch(/\.ui-split-panel \{ background: rgb\(247 245 252\); \}/);
  });
});

describe('the logo follows its colour tokens', () => {
  it('ClorTick paints from --logo-mark, --logo-word and --logo-dot unless a caller sets a colour', () => {
    const tick = read('packages/ui/src/components/brand/ClorTick.jsx');
    expect(tick).toContain("rgb(var(--logo-mark, 35 42 102))");
    expect(tick).toContain("rgb(var(--logo-word, 35 42 102))");
    expect(tick).toContain("rgb(var(--logo-dot, 245 166 35))");
    expect(tick).not.toMatch(/color = INDIGO|fill=\{color\}|stroke=\{color\}/);
  });

  it('on the indigo bar the mark is marigold and CLOR is Cotton', () => {
    expect(block).toMatch(/--logo-mark: var\(--marigold\);\n\s*--logo-word: var\(--cotton\);/);
    expect(contrast(COTTON, frame)).toBeGreaterThan(12);
  });
});

describe("DESIGN.md's shapes and type floor in People", () => {
  it('buttons, fields and tabs take 8px; nothing pressable is a 999px pill', () => {
    expect(people).toMatch(/\[data-palette='sky'\] \{\n\s*--radius-btn: 0\.5rem;\n\s*--radius-input: 0\.5rem;/);
    expect(people).not.toMatch(/\.ui-btn:not\(\.ui-icon-btn\) \{ border-radius: 999px/);
    expect(people).not.toMatch(/\.ui-search-field \.ui-input \{ border-radius: 999px/);
    expect(people).not.toMatch(/\.ui-record-tablist \.ui-tab \{[^}]*border-radius: 999px/);
    const pill = people.match(/\n\.soft-pill \{[^}]*\}/)[0];
    expect(pill).toContain('border-radius: var(--radius-btn);');
  });

  it('content holders take 12px, not 20', () => {
    expect(people).toMatch(/#main-content \{\n\s*--soft-card-r: 0\.75rem;/);
    expect(people).not.toMatch(/border-radius: 1\.25rem/);
  });

  it('rail labels are at the 12px floor', () => {
    expect(people).toMatch(/:root\[data-palette='sky'\] \.ui-split-mod \{ font-size: 0\.75rem;/);
    expect(people).toMatch(/:root\[data-palette='sky'\] \.ui-split-mod > span \{ font-size: 0\.75rem;/);
    expect(people).not.toMatch(/\.ui-split-mod[^{]*\{[^}]*font-size: 0\.6875rem/);
  });
});

describe('Home: one primary action, and what waits on you comes first', () => {
  const home = read('apps/people/src/screens/PeopleOverview.jsx');

  it('Add an employee is the only primary; Check in steps down on Home', () => {
    expect(home.match(/soft-pill-primary|ui-btn-primary/g)).toHaveLength(1);
    expect(read('packages/ui/src/timeOff/MyDays.jsx')).toContain('<CheckInCard me={me} onChanged={load} secondary />');
  });

  it('the setup list sits after Waiting for you, not between the greeting and it', () => {
    const waiting = home.indexOf('title="Waiting for you"');
    const setup = home.indexOf('<HomeSetup ');
    const layout = home.indexOf('<div className="soft-layout">');
    expect(waiting).toBeGreaterThan(-1);
    expect(setup).toBeGreaterThan(waiting);
    expect(layout).toBeLessThan(waiting);
  });
});
