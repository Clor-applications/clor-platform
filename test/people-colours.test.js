import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { colorOf, swatchOf } from '../packages/ui/src/timeOff/api';

/**
 * People's brand colours used where they belong (owner, 31 Oct 2026: "yellow and other colors not utilised
 * properly", then "Yes, all ten"). Marigold marks what waits on you, lilac what is chosen or done, away has its
 * own mark, red is only for what went wrong, and charts, teams and leave types draw from one brand series.
 * The audit: docs/people/design-v1/COLOUR-AUDIT-2026-10-31.md.
 */
const read = (f) => readFileSync(f, 'utf8');
const people = read('packages/ui/src/people.css');
const index = read('packages/ui/src/index.css');
const block = people.slice(people.indexOf('Brand colours where they belong'));
const token = (src, name) => (src.match(new RegExp(`--${name}:\\s*([\\d ]+);`)) || [])[1]?.trim();

const lum = (rgb) => {
  const c = rgb.split(' ').map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const WHITE = '255 255 255';
const INDIGO = '35 42 102';
const MARIGOLD = '245 166 35';

describe('counts that wait on you are marigold', () => {
  it('styles the count class the tabs render, not one that does not exist', () => {
    expect(people).not.toMatch(/\.ui-tab \.ui-count|\.ui-split-panel \.ui-count/);
    expect(people).toMatch(/:is\(\.ui-tab-count, \.ui-side-count\)\[data-tone='warn'\] \{ background: rgb\(var\(--warm\)\) !important; color: rgb\(var\(--brand\)\) !important;/);
  });

  it.each([
    ['apps/people/src/screens/Approvals.jsx', 'data-tone="warn"'],
    ['packages/ui/src/timeOff/LeaveRequests.jsx', "data-tone={k === 'PENDING' ? 'warn' : undefined}"],
    ['packages/ui/src/timeOff/AttendanceRequests.jsx', "data-tone={k === 'PENDING' ? 'warn' : undefined}"],
    ['packages/ui/src/timeOff/TeamAttendance.jsx', "data-tone={k === 'NONE' ? 'warn' : undefined}"],
    ['packages/ui/src/lifecycle/Tasks.jsx', "data-tone={k === 'late' ? 'warn' : undefined}"],
    ['packages/ui/src/lifecycle/Changes.jsx', "data-tone={k === 'approval' ? 'warn' : undefined}"],
  ])('%s marks its waiting tab', (file, mark) => {
    expect(read(file)).toContain(`<span className="ui-tab-count tabular-nums" ${mark}>`);
  });

  it('the bell count is 12px, red by default and marigold in People, with a dot on unread lines', () => {
    const bell = read('packages/shell/NotificationBell.jsx');
    expect(bell).not.toMatch(/text-\[10px\]/);
    expect(bell).toContain('className="ui-bell-count"');
    expect(bell).toContain('className="ui-bell-unread"');
    expect(index).toMatch(/\.ui-bell-count \{[^}]*font-size: 0\.75rem;[^}]*background: rgb\(var\(--neg\)\)/);
    expect(index).toMatch(/\.ui-bell-unread \{ display: none;/);
    expect(block).toMatch(/\.ui-bell-count \{ background: rgb\(var\(--warm\)\); color: rgb\(var\(--brand\)\); \}/);
  });

  it('side blocks whose count waits on you mark it, and the timeline warning dot is a marigold mark', () => {
    expect(read('packages/ui/src/components/list/SidePanel.jsx')).toContain('<span className="ui-side-count" data-tone={tone}>');
    const panels = read('apps/people/src/panels.jsx');
    for (const t of ['Waiting longest', 'Needs setting up', 'Late, by owner', 'Waiting for a decision']) expect(panels, t).toMatch(new RegExp(`title="${t}"[^>]*tone="warn"`));
    expect(index).toMatch(/\.ui-side-timeline > li\[data-tone='warn'\] \.ui-side-dot \{ background: rgb\(var\(--warn-mark, var\(--warn\)\)\);/);
  });

  it("Home's waiting rows and an unfinished setup step take marigold, once per row", () => {
    const home = read('apps/people/src/screens/PeopleOverview.jsx');
    expect(home).toContain("data-tone={t.tone === 'info' ? undefined : 'warn'}");
    /* The count tile carries the marigold; "This week" beside it is quiet, so the row does not shout twice. */
    expect(home).toContain("soon: { label: 'This week', pill: 'neutral' }");
    expect(read('apps/people/src/screens/HomeSetup.jsx')).toContain("s.optional ? 'ui-pill-neutral' : 'ui-pill-warn'");
    expect(block).toMatch(/\.people-row-count\[data-tone='warn'\] \{ background: rgb\(var\(--warm\)\)/);
  });

  it('a figure that waits on you and is above nought gets the marigold bar', () => {
    expect(read('packages/ui/src/timeOff/TimeOverview.jsx')).toContain('data-attention={(attention && Number(value) > 0) || undefined}');
    expect(read('packages/ui/src/lifecycle/Overview.jsx')).toContain('data-zero={Number(value) === 0 || undefined}');
    expect(block).toMatch(/\.ui-metric\[data-attention\] \{ box-shadow: inset 0 3px 0 rgb\(var\(--warm\)\); \}/);
  });
});

describe('figures', () => {
  it('indigo figures leave a nought to the quiet grey rule', () => {
    const indigo = people.match(/^.*#main-content :is\(h1, h2, [^{]*\{ color: rgb\(var\(--brand\)\); \}$/m)[0];
    expect(indigo).toContain('.ui-metric:not([data-zero]) .ui-metric-value');
    expect(indigo).not.toMatch(/, \.ui-metric-value,/);
    expect(people).toMatch(/\.ui-metric\[data-zero\] \.ui-metric-value \{ color: rgb\(var\(--fg-subtle\)\)/);
  });

  it.each([
    ['apps/people/src/workforce/Directory.jsx', 5],
    ['apps/people/src/workforce/ImportEmployees.jsx', 3],
    ['packages/ui/src/lifecycle/Overview.jsx', 1],
    ['packages/ui/src/timeOff/TimeOverview.jsx', 1],
  ])('%s marks a nought on its figures', (file, n) => {
    const src = read(file);
    expect((src.match(/className="ui-metric"[^>]*data-zero=/g) || []).length).toBeGreaterThanOrEqual(n);
    expect(src).not.toMatch(/<div className="ui-metric"><span><dd className="ui-metric-value/);
  });

  it('figure cards that are not buttons (the People report) wear brand D too', () => {
    expect(people).not.toMatch(/section > button\.ui-card/);
    expect(people.match(/section > :is\(button, div\)\.ui-card/g)).toHaveLength(3);
  });
});

describe('status tokens in brand D', () => {
  it('warnings: marigold marks, words in a readable warm ink, never marigold text', () => {
    expect(token(block, 'warn-mark')).toBe(MARIGOLD);
    expect(token(block, 'warn')).not.toBe(MARIGOLD);
    expect(contrast(token(block, 'warn'), WHITE)).toBeGreaterThan(4.5);
    expect(token(block, 'warn-soft')).toBe('254 241 214');
    expect(contrast(INDIGO, token(block, 'warn-soft'))).toBeGreaterThan(4.5);
    expect(block).toMatch(/\.ui-attention-dot\.is-warn \{ background: rgb\(var\(--warn-mark\)\); \}/);
  });

  it("red is DESIGN's #B91C1C, readable on white and on its soft tint", () => {
    expect(token(block, 'neg')).toBe('185 28 28');
    expect(contrast(token(block, 'neg'), WHITE)).toBeGreaterThan(4.5);
    expect(contrast(token(block, 'neg'), token(block, 'neg-soft'))).toBeGreaterThan(4.5);
  });

  it('away has its own mark, apart from Present\'s indigo, and is never text', () => {
    expect(token(block, 'away')).toBe('141 132 198');
    expect(contrast(token(block, 'away'), WHITE)).toBeGreaterThan(3);
    expect(contrast(token(block, 'away'), INDIGO)).toBeGreaterThan(3);
    expect(block).toMatch(/\.att-summary \[data-tone='info'\] \{ --t: var\(--away\); \}/);
    expect(block).not.toMatch(/color: rgb\(var\(--away\)\)/);
  });

  it('a clash is a look-here line, not an error', () => {
    expect(read('apps/people/src/panels.jsx')).toContain('<SideAlert key={`c-${c.dept}`} tone="warn"');
    expect(block).toMatch(/\.ui-side-alert\[data-tone='warn'\] \{ box-shadow: inset 3px 0 0 rgb\(var\(--warm\)\); \}/);
  });

  it('indigo on marigold, the one way marigold carries words, clears AA', () => {
    expect(contrast(INDIGO, MARIGOLD)).toBeGreaterThan(4.5);
    expect(contrast(MARIGOLD, WHITE)).toBeLessThan(3);
  });
});

describe('one brand series for charts, teams and leave types', () => {
  it('teams: indigo, marigold, away first; no-team stays grey', () => {
    expect(token(block, 'dept-1')).toBe(INDIGO);
    expect(token(block, 'dept-2')).toBe(MARIGOLD);
    expect(token(block, 'dept-3')).toBe('141 132 198');
    expect(token(block, 'dept-0')).toBe('104 107 124');
  });

  it('every team mark but marigold reads at least 3:1 on white', () => {
    for (let i = 0; i <= 8; i += 1) {
      const slot = token(block, `dept-${i}`);
      if (slot !== MARIGOLD) expect(contrast(slot, WHITE), `dept-${i}`).toBeGreaterThan(3);
    }
  });

  it('the most common leave type wears the away mark, and the warning brown is never a leave colour', () => {
    expect(swatchOf({ name: 'Casual leave' })).toBe('rgb(var(--leave-6))');
    expect(token(block, 'leave-6')).toBe(token(block, 'away'));
    for (let i = 0; i < 8; i += 1) expect(token(block, `leave-${i}`), `leave-${i}`).not.toBe(token(block, 'warn'));
  });

  it('the gender bar takes the first two of the series, not blue and crimson', () => {
    const home = read('apps/people/src/screens/PeopleOverview.jsx');
    expect(home).not.toMatch(/\[6, 3, 5\]/);
    expect(home.match(/\[1, 2, 3\]\[i\] \?\? 8/g)).toHaveLength(2);
  });

  it('faces: initials in indigo on their team wash', () => {
    expect(block).toMatch(/\.people-face \{ color: rgb\(var\(--brand\)\); background: rgb\(var\(--dept\) \/ 0\.16\); \}/);
  });

  it('a leave type nobody coloured draws its slot token; its own colour wins; the picker still gets a hex', () => {
    expect(swatchOf({ color: '#123456', name: 'Casual leave' })).toBe('#123456');
    expect(swatchOf({ name: 'Casual leave' })).toMatch(/^rgb\(var\(--leave-[0-7]\)\)$/);
    expect(colorOf({ name: 'Casual leave' })).toMatch(/^#[0-9a-f]{6}$/);
    for (let i = 0; i < 8; i += 1) {
      expect(token(index, `leave-${i}`), `base leave-${i}`).toBeTruthy();
      const slot = token(block, `leave-${i}`);
      /* A leave type is not an error, so never red; every slot but marigold (a fill by rule) reads as a mark on white. */
      expect(slot, `brand D leave-${i}`).not.toBe(token(block, 'neg'));
      if (slot !== MARIGOLD) expect(contrast(slot, WHITE), `brand D leave-${i}`).toBeGreaterThan(3);
    }
    for (const f of ['LeaveBalances', 'LeaveCalendar', 'LeaveRegister', 'LeaveRequests']) {
      expect(read(`packages/ui/src/timeOff/${f}.jsx`), f).not.toMatch(/colorOf\(/);
    }
  });
});

describe('chosen and the employee app', () => {
  it("the module panel's open screen sits on the lilac tile with a line", () => {
    expect(block).toMatch(/\.ui-split-panel \.ui-split-item\[aria-current='page'\] \{\n\s*background: rgb\(var\(--brand-soft\)\); box-shadow: inset 0 0 0 1px rgb\(var\(--brand-border\)\);/);
  });

  it("the employee app wears brand D's waiting through its own data-brand, not the sky palette", () => {
    const portal = read('apps/attendance/src/portal/EmployeePortal.jsx');
    expect(portal).toContain('className="ui-portal min-h-dvh pb-20" data-brand="d"');
    expect(portal).not.toMatch(/data-palette/);
    const rules = block.slice(block.indexOf('The employee app'));
    expect(rules).toMatch(/\.ui-portal\[data-brand='d'\] \.ui-pill-warn \{ background: rgb\(var\(--marigold\)\); color: rgb\(var\(--indigo\)\); \}/);
    for (const line of rules.split('\n').filter((l) => l.includes('{'))) expect(line).toContain(".ui-portal[data-brand='d']");
  });
});
