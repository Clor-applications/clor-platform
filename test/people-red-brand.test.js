import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * People in the red brand (owner, 3 Nov 2026: "go with red combination", then "header keep white only"). The rail is
 * oxblood, the module panel blush, the top bar and the work area white, and colour comes in solid blocks. It began as
 * the deep indigo frame of 2 Nov (direction A of three, after "too pale, washed out" and "generic"); the shapes and
 * the contrast floors are the same, the colours are red.
 * The design note: DESIGN.md, Color → the red brand.
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
const RED = '200 16 46';
const RED_INK = '165 13 38';
const OXBLOOD = '92 10 22';
const INK = '31 26 28';
const MARIGOLD = '245 166 35';
const BLUSH = '251 232 234';

const frame = token(block, 'frame');
const panel = token(block, 'frame-panel');
const hi = token(block, 'frame-hi');
const onFrame = token(block, 'on-frame');
const onMuted = token(block, 'on-frame-muted');
const panelHi = token(block, 'panel-hi');
const onPanel = token(block, 'on-panel');
const onPanelMuted = token(block, 'on-panel-muted');

describe('the rail is oxblood, and every word on it reads', () => {
  it('defines the frame tokens once, in the light sky palette', () => {
    expect(block).toMatch(/^:root\[data-palette='sky'\]:not\(\[data-theme='dark'\]\),\n:root:not\(\[data-theme='dark'\]\) \[data-palette='sky'\] \{\n\s*--frame: 92 10 22;/m);
    expect(frame).toBe(OXBLOOD);
    expect(panel).toBe(BLUSH);
    expect(onPanel).toBe(INK);
    for (const t of [frame, panel, hi, onFrame, onMuted, panelHi, onPanel, onPanelMuted]) expect(t).toMatch(/^\d+ \d+ \d+$/);
  });

  it('the frame stands apart from the white work area (was 1.08:1)', () => {
    expect(contrast(frame, WHITE)).toBeGreaterThan(12);
  });

  it('one oxblood: Home\'s greeting and the record\'s header are the rail\'s own colour (3 Nov 2026)', () => {
    expect(block).toMatch(/\.people-home > header\.soft-band-top \{\n\s*[^}]*background: rgb\(var\(--frame\)\);/);
    expect(block).toMatch(/--page-heading-bg: var\(--frame\);/);
    expect(contrast(onMuted, frame)).toBeGreaterThan(7);
  });

  it('the rail and the module panel are two grounds, not one (3 Nov 2026)', () => {
    expect(contrast(frame, panel)).toBeGreaterThan(10);
    expect(block).toMatch(/\.ui-split-panel \{ background: rgb\(var\(--frame-panel\)\); border-right: 1px solid rgb\(var\(--panel-line\)\); \}/);
  });

  it('labels, group names and menu words clear AA on the bar, the panel and a hovered row', () => {
    expect(contrast(onFrame, frame)).toBeGreaterThan(7);
    expect(contrast(onMuted, frame)).toBeGreaterThan(7);
    expect(contrast(onMuted, hi)).toBeGreaterThan(4.5);
    expect(contrast(WHITE, hi)).toBeGreaterThan(7);
    expect(contrast(onPanel, panel)).toBeGreaterThan(7);
    expect(contrast(onPanel, panelHi)).toBeGreaterThan(7);
    expect(contrast(onPanelMuted, panel)).toBeGreaterThan(4.5);
    expect(contrast(onPanelMuted, panelHi)).toBeGreaterThan(4.5);
  });

  it('the open screen is a white tile on the blush panel, with red words and a red edge (the board)', () => {
    expect(contrast(RED_INK, WHITE)).toBeGreaterThan(7);
    expect(token(people.slice(people.indexOf('The red brand (owner, 3 Nov 2026')), 'brand-ink')).toBe(RED_INK);
    expect(block).toMatch(/\.ui-split-panel \.ui-split-item\[aria-current='page'\] \{\n\s*background: rgb\(255 255 255\); color: rgb\(var\(--brand-ink\)\);[^}]*inset 3px 0 0 rgb\(var\(--red\)\)/);
  });

  it('marigold on the rail is a fill or a mark: the open module and the waiting tile, oxblood words on it', () => {
    expect(contrast(MARIGOLD, frame)).toBeGreaterThan(6);
    expect(contrast(OXBLOOD, MARIGOLD)).toBeGreaterThan(4.5);
    expect(block).toMatch(/\.ui-split-rail \.ui-split-mod\[data-current\] \.ui-glyph \[opacity='0\.2'\] \{ fill: rgb\(var\(--marigold\)\); \}/);
    expect(block).toMatch(/\.soft-band-stat\[data-attention\] \{ background: rgb\(var\(--marigold\)\); \}/);
    expect(read('apps/people/src/screens/PeopleOverview.jsx')).toContain('data-attention={waiting > 0 || undefined}');
  });

  it('the work area keeps readable support text and a firmer row line', () => {
    expect(contrast(token(block, 'fg-muted'), WHITE)).toBeGreaterThan(7);
    expect(contrast(OXBLOOD, token(block, 'heading-bg'))).toBeGreaterThan(7);
    expect(contrast(token(block, 'border'), WHITE)).toBeGreaterThan(1.26);
  });

  it('the rail redefines the shared tokens; the top bar stays white with the red logo ("header keep white only")', () => {
    expect(block).toMatch(/\.ui-split-rail \{\n\s*--surface: var\(--frame-field\);/);
    expect(block).not.toMatch(/:is\(\.ui-topbar, \.ui-split-rail\)/);
    expect(block).toMatch(/\.ui-split-panel \{\n\s*--surface: 255 255 255;[\s\S]*?--fg: var\(--on-panel\);/);
    expect(block).toMatch(/\.ui-topbar \{ background-color: rgb\(255 255 255\) !important; border-bottom-color: rgb\(var\(--border\)\) !important; \}/);
    expect(block).not.toMatch(/--logo-mark/);
    expect(contrast(WHITE, RED)).toBeGreaterThan(4.5);
  });

  it('stays in People: every rule of the block is on the light sky palette', () => {
    const rules = block.split('\n').filter((l) => /\{\s*$|\{ .*\}$/.test(l) && !l.trim().startsWith('/*') && !l.includes('@media'));
    expect(rules.length).toBeGreaterThan(40);
    for (const l of rules) expect(l, l).toMatch(/data-palette='sky'\]|^\s+--|^\s+[a-z-]+:/);
    expect(block).not.toMatch(/data-app=/);
  });

  it('the superseded Cotton rail, pale lilac panel and indigo frame are gone', () => {
    expect(block).not.toMatch(/\b(35 42 102|27 33 82|233 229 244)\b/);
    expect(block).not.toMatch(/var\(--(indigo|lilac|cotton)\)/);
    expect(people).not.toMatch(/:is\(\.ui-split-rail, \.ui-split-panel\) \{ background: rgb\(250 246 238\); \}/);
    expect(people).not.toMatch(/\.ui-split-panel \{ background: rgb\(247 245 252\); \}/);
  });
});

describe('the logo is the owner\'s traced wordmark, painted from its tokens', () => {
  const paths = read('packages/ui/src/components/brand/clorPaths.js');
  const logo = read('packages/ui/src/components/brand/ClorLogo.jsx');
  const mark = read('packages/ui/src/components/brand/ClorMark.jsx');

  it('draws CLOR from outlines, not type, and the C keeps its own dot', () => {
    for (const k of ['C', 'L', 'O', 'R', 'DOT']) expect(paths).toMatch(new RegExp(`export const ${k} = 'M[\\d.]`));
    expect(logo).not.toMatch(/<text|fontFamily/);
    expect(logo).toMatch(/<path d=\{C\} \/>\s*<path d=\{L\} \/>\s*<path d=\{O\} \/>\s*<path d=\{R\} \/>/);
    expect(mark).toContain('<path d={C} fill={color || MARK} />');
  });

  it('paints from --logo-mark and --logo-dot unless a caller sets a colour: red letters and a marigold dot', () => {
    for (const f of [logo, mark]) {
      expect(f).toContain('rgb(var(--logo-mark, 200 16 46))');
      expect(f).toContain('rgb(var(--logo-dot, 245 166 35))');
    }
    const css = read('packages/ui/src/index.css');
    expect(css).toMatch(/--logo-mark: var\(--red\); --logo-dot: var\(--marigold\);/);
  });

  it('nothing draws the retired C-tick any more', () => {
    expect(() => read('packages/ui/src/components/brand/ClorTick.jsx')).toThrow();
    for (const f of ['public/icon.svg', 'public/logo.svg', 'public/brand/clor-mark.svg', 'public/icons/people.svg']) {
      expect(read(f), f).not.toContain('M74.04 25.96');
      expect(read(f), f).toContain('#C8102E');
    }
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

  it('fields in drawers and dialogs take 8px too', () => {
    expect(people).toMatch(/\.ui-scrim :is\(\.ui-input, \.ui-select, textarea\.ui-input\) \{ border-radius: var\(--radius-input\);/);
    expect(people).not.toMatch(/:is\(\.ui-input, \.ui-select, textarea\.ui-input\) \{ border-radius: 0\.75rem/);
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

  it('a nought on Home is quiet: no marigold in the sentence, grey figures (the zero rule)', () => {
    expect(home).toContain("<strong data-zero={outToday.length === 0 || undefined}>");
    expect((home.match(/className="soft-band-stat-value" data-zero=/g) || []).length).toBe(4);
    expect(block).toMatch(/\.soft-band-sub strong\[data-zero\] \{ color: inherit; font-weight: 400; \}/);
    expect(block).toMatch(/\.soft-band-stat-value\[data-zero\] \{ color: rgb\(var\(--fg-subtle\)\) !important; font-weight: 600; \}/);
    expect(contrast(token(people.slice(people.indexOf('Brand D, each colour with its own job')), 'fg-subtle'), BLUSH)).toBeGreaterThan(3);
    expect(contrast(onPanelMuted, panel)).toBeGreaterThan(4.5);
  });

  it('on a phone a waiting row stacks Review and Approve under the name, 44px targets', () => {
    const phone = people.match(/@media \(max-width: 640px\) \{\n {2}\/\* A waiting row on a phone[\s\S]*?\n\}/)[0];
    expect(phone).toContain('.people-approval > .min-w-0.flex-1 + div { flex: 1 1 100%;');
    expect(phone).toContain('min-height: 2.75rem;');
  });

  it('on a phone Waiting for you comes before the figures, so its first request is above the fold', () => {
    expect(block).toMatch(/@media \(max-width: 767px\) \{[\s\S]*\.soft-main > \.soft-bezel:has\(#todo-h\) \{ order: -1; \}/);
  });

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
