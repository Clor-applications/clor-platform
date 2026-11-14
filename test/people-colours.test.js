import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { colorOf, swatchOf } from '../packages/ui/src/timeOff/api';

/**
 * Moss (R&D redesign, owner 14 Nov 2026) replaced the red, coral and marigold brands below; the tests on those
 * colours went with them. What stays: tones and tints named by meaning in the JSX, and the moss rules at the end.
 *
 * People's brand colours used where they belong (owner, 31 Oct 2026: "yellow and other colors not utilised
 * properly", then "Yes, all ten"; red brand from 3 Nov 2026). Marigold marks what waits on you, blush what is chosen or done, away has its
 * own mark, red is only for what went wrong, and charts, teams and leave types draw from one brand series.
 * The audit: docs/people/design-v1/COLOUR-AUDIT-2026-10-31.md.
 */
const read = (f) => readFileSync(f, 'utf8');
const people = read('packages/ui/src/people.css');
const index = read('packages/ui/src/index.css');


describe('counts that wait on you are marked', () => {

  /* The tabs are ListHeader's now (People plan 8 Nov 2026, step 3): a screen names the tone, the header draws the count. */
  it.each([
    ['apps/people/src/screens/Approvals.jsx', "tone: 'warn'"],
    ['packages/ui/src/timeOff/LeaveRequests.jsx', "tone: k === 'PENDING' ? 'warn' : undefined"],
    ['packages/ui/src/timeOff/AttendanceRequests.jsx', "tone: k === 'PENDING' ? 'warn' : undefined"],
    ['packages/ui/src/timeOff/TeamAttendance.jsx', "tone: k === 'NONE' ? 'warn' : undefined"],
    ['packages/ui/src/lifecycle/Tasks.jsx', "tone: k === 'late' ? 'warn' : undefined"],
    ['packages/ui/src/lifecycle/Changes.jsx', "tone: k === 'approval' ? 'warn' : undefined"],
  ])('%s marks its waiting tab', (file, mark) => {
    expect(read(file)).toContain(mark);
    expect(read('packages/ui/src/components/list/ListHeader.jsx')).toContain('<span className="ui-tab-count tabular-nums" data-tone={t.tone || undefined}>');
  });


  it('side blocks whose count waits on you mark it, and the timeline warning dot is a marigold mark', () => {
    expect(read('packages/ui/src/components/list/SidePanel.jsx')).toContain('<span className="ui-side-count" data-tone={tone}>');
    const panels = read('apps/people/src/panels.jsx');
    for (const t of ['Needs setting up', 'Late, by owner']) expect(panels, t).toMatch(new RegExp(`title="${t}"[^>]*tone="warn"`));
    expect(index).toMatch(/\.ui-side-timeline > li\[data-tone='warn'\] \.ui-side-dot \{ background: rgb\(var\(--warn-mark, var\(--warn\)\)\);/);
  });


});

describe('figures', () => {

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
    expect(people).toMatch(/section > :is\(button, div\)\.ui-card\[data-tint\] > span:first-child \{ background: rgb\(var\(--tint\)\) !important; color: rgb\(var\(--tint-ink\)\) !important; \}/);
  });
});

/*
 * Colour by meaning, never by place (review of #123, 4 Nov 2026): a strip, a figure card or a quick link takes the
 * tint its caller names, so marigold lands only on what waits on the reader and a figure keeps its colour when the
 * one beside it is hidden.
 */
describe('tints are named by meaning, not handed out by position', () => {
  const tintsIn = (src) => [...src.matchAll(/label: '([^']+)'[^\n]*?tint: '(\w+)'/g)].map(([, label, tint]) => [label, tint]);
  it('no tint in People is picked by nth-child', () => {
    expect(people).not.toMatch(/nth-child\(5n/);
    expect(people).not.toMatch(/:nth-child\([^)]*\)[^{\n]*\{[^}\n]*(--tint|-ink\))/);
  });
  it('the shared figure cards on People screens each name a tint; only "To decide" is marigold', () => {
    const revisions = Object.fromEntries(tintsIn(read('apps/payroll/src/screens/SalaryRevisions.jsx')));
    expect(revisions).toMatchObject({ 'To decide': 'butter', Approved: 'mint', 'Yearly rise': 'sky', 'Average rise': 'lilac' });
    /* R&D tiles (14 Nov 2026): each tile names its categorical accent in the source, never by its index. */
    const report = read('apps/people/src/screens/PeopleReports.jsx');
    expect(report).toMatch(/label: 'Headcount today', [^\n]*accent: 1/);
    expect(report).toMatch(/label: 'Joiners', [^\n]*accent: 2/);
    expect(report).toMatch(/label: 'Attrition', [^\n]*accent: 4/);
    expect(read('packages/ui/src/components/list/ListPageParts.jsx')).toMatch(/data-tint=\{card\.tint \|\| undefined\}/);
  });
  it('no quick links in People any more: the module panel names the screens (plan 8 Nov 2026, §3 rule 3)', () => {
    expect(read('apps/people/src/panels.jsx')).not.toMatch(/SideLinks|Quick links/);
    expect(read('packages/ui/src/components/list/SidePanel.jsx')).not.toMatch(/ui-side-today/);
  });
  it('apps/people/src/workforce/Directory.jsx: each R&D tile names its categorical accent', () => {
    const tiles = [...read('apps/people/src/workforce/Directory.jsx').matchAll(/\{ key: '\w+', label: '[^']+', cat: (\d)/g)];
    expect(tiles.length).toBeGreaterThan(2);
  });
  it.each([
    'apps/people/src/organization/Overview.jsx',
    'packages/ui/src/lifecycle/Overview.jsx',
    'packages/ui/src/timeOff/TimeOverview.jsx',
  ])('%s: each figure in the strip names a tint, marigold only on one that waits on you', (file) => {
    const src = read(file);
    const items = [...src.matchAll(/\{ k: '\w+',[^\n]*/g)].map(([line]) => line).filter((line) => /value:/.test(line) && /Icon/.test(line));
    expect(items.length).toBeGreaterThan(2);
    for (const line of items) {
      expect(line).toMatch(/tint: '(sky|mint|peach|lilac|butter)'/);
      expect(/tint: 'butter'/.test(line), line).toBe(/attention: true/.test(line));
    }
    expect(src).toMatch(/role="listitem"[^>]*data-tint=\{tint\}/);
  });
  it('People\'s JSX never picks a tint by a row\'s index', () => {
    const files = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const f = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(f);
        else if (/\.jsx?$/.test(e.name) && !/\.test\./.test(e.name)) files.push(f);
      }
    };
    ['apps/people/src', 'packages/ui/src/personnel', 'packages/ui/src/lifecycle', 'packages/ui/src/timeOff', 'packages/ui/src/components/list'].forEach(walk);
    expect(files.length).toBeGreaterThan(50);
    const byIndex = [
      /\[\s*'(sky|mint|lilac|peach|butter)'[^\]]*\]\s*\[[^\]]*%/, // ['sky', 'mint'][i % 2]
      /data-(tint|tone)=\{[^}]*\b[ijk]\s*%/, // data-tint={X[i % n]}
      /(TINTS|TONES)\[\s*\(?\s*[ijk]\b/, // TONES[i % TONES.length]
      /\.map\(\(\w+, [ijk]\) => \[\w+, (TINTS|TONES|\w*_TINTS)\[/, // new Map(names.map((d, i) => [d, TONES[i]]))
    ];
    for (const f of files) for (const re of byIndex) expect(read(f), `${f} ${re}`).not.toMatch(re);
  });
  it('faces hash over the eight categorical colours, none marigold, and the record keeps the person\'s own', () => {
    expect(read('packages/ui/src/personnel/Employees.jsx')).toMatch(/% 9973, 0\) % 8\) \+ 1/);
    expect(people).not.toMatch(/data-hue='4'/);
    expect(people).not.toMatch(/\.ui-avatar-initials\[data-hue='\d'\] \{[^}]*--butter/);
    expect(people).not.toMatch(/\.ui-profile \.ui-avatar-initials \{ background: rgb\(var\(--marigold\)\)/);
  });
  it('every figure strip names its tints, Data health\'s gaps clay', () => {
    /* Data check (PEOPLE-26) moved to two R&D tiles: the score with its bar, and what blocks payday in the problem colour. */
    const health = read('packages/ui/src/personnel/DataHealth.jsx');
    expect(health.match(/className="dh-tile"/g)).toHaveLength(2);
    expect(health).toMatch(/className="dh-tile-value" data-tone=\{data\.blocking \? 'neg'/);
    for (const f of ['apps/people/src/workforce/ImportEmployees.jsx', 'apps/people/src/workforce/Directory.jsx', 'packages/ui/src/personnel/DataHealth.jsx']) {
      expect(read(f), f).not.toMatch(/<div className="ui-metric"(?! data-tint)[ >]/);
    }
    expect(read('packages/ui/src/timeOff/YearEnd.jsx')).toMatch(/\['lapse', 'Lapses', lapses, 'peach'\]\][\s\S]*role="listitem" data-tint=\{tint\}/);
  });
});

describe('moss: People declares no brand of its own (R&D redesign, 14 Nov 2026)', () => {
  it('declares no brand, neutral or status token: rnd.css owns them', () => {
    const declared = [...people.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map(([, n]) => n);
    const brand = declared.filter((n) => /^--(brand|act|marker|tint$|panel|fg|surface|border|app-bg|pos|neg|warn|info|ring|link|choice|rail|frame|oxblood|marigold|teal|warm|butter|mint|lilac|peach|sky|on-)/.test(n));
    expect(brand).toEqual([]);
    expect(people).not.toMatch(/var\(--(oxblood|marigold|teal|warm|blush|frame|kind-|btn-icon)/);
  });

  it('points teams, chart series and leave slots at the categorical palette, never past eight', () => {
    for (let i = 1; i <= 8; i += 1) expect(people).toContain(`--dept-${i}: var(--cat-${i});`);
    for (let i = 0; i <= 7; i += 1) expect(people).toContain(`--leave-${i}: var(--cat-${i + 1});`);
    expect(people).not.toMatch(/--cat-9/);
  });

  it('gives each identity tint a categorical accent', () => {
    for (const [tint, cat] of [['sky', 1], ['peach', 2], ['mint', 3], ['butter', 4], ['lilac', 7]]) {
      expect(people).toMatch(new RegExp(`\\[data-tint='${tint}'\\] *\\{ --id: var\\(--cat-${cat}\\);`));
    }
  });

  it('draws the figure strip as KPI tiles: 36px chip, 12px uppercase label, 28px tabular number, 3px top accent', () => {
    expect(people).toMatch(/\.ui-metric-strip > \* \{[^}]*border-radius: 0\.75rem;[^}]*box-shadow: inset 0 3px 0 rgb\(var\(--id\)\);/);
    expect(people).toMatch(/\.ui-metric-icon \{[^}]*width: 2\.25rem;[^}]*height: 2\.25rem;/);
    expect(people).toMatch(/\.ui-metric-label \{[^}]*font-size: 0\.75rem;[^}]*text-transform: uppercase;/);
    expect(people).toMatch(/\.ui-metric-value \{[^}]*font-size: 1\.75rem;[^}]*font-variant-numeric: tabular-nums;/);
    expect(people).toMatch(/\.ui-metric\[data-zero\] \.ui-metric-value \{ color: rgb\(var\(--fg-subtle\)\); \}/);
    expect(people).toMatch(/\.ui-metric\[data-attention\] \.ui-metric-value \{ color: rgb\(var\(--warn\)\); \}/);
  });

  it('shows the page description at 14px and the back link at 13px', () => {
    expect(people).toMatch(/\.ui-page-heading p\.ui-muted\.ui-t-body \{ display: block;[^}]*font-size: 0\.875rem;/);
    expect(people).toMatch(/\.ui-breadcrumb \{[^}]*font-size: 0\.8125rem;/);
  });

  it("folds every Settings group but the open screen's", () => {
    expect(people).toContain(".ui-split-panel[aria-label='Settings screens'] > div:has(> p.ui-caption):not(:has([aria-current='page'])) > .ui-split-item { position: absolute; visibility: hidden; clip-path: inset(50%); pointer-events: none; }");
  });

  it('a waiting count is the Attention status, never a brand fill', () => {
    expect(people).not.toMatch(/\.ui-tab \.ui-count|\.ui-split-panel \.ui-count/);
    expect(people).toMatch(/:is\(\.ui-tab-count, \.ui-side-count\)\[data-tone='warn'\] \{ background: rgb\(var\(--warn-soft\)\) !important; color: rgb\(var\(--warn-ink\)\) !important;/);
    expect(people).toMatch(/\.people-row-count\[data-tone='warn'\] \{ background: rgb\(var\(--warn-soft\)\); color: rgb\(var\(--warn-ink\)\); \}/);
    expect(read('apps/people/src/screens/PeopleOverview.jsx')).toContain("data-tone={t.tone === 'info' ? undefined : 'warn'}");
    expect(index).toMatch(/\.ui-bell-count \{[^}]*font-size: 0\.75rem;/);
  });

  it('the employee app marks waiting and the open tab through its own data-brand', () => {
    const rules = people.slice(people.indexOf('The employee app (shared with Attendance'));
    for (const line of rules.split('\n').filter((l) => l.includes('{'))) expect(line).toContain(".ui-portal[data-brand='d']");
  });
});

describe('leave types wear the leave tokens (audit M11)', () => {
  it('the common kinds draw their own token, any other type its slot', () => {
    expect(swatchOf({ name: 'Casual Leave' })).toMatch(/^rgb\(var\(--leave-casual, var\(--leave-\d\)\)\)$/);
    expect(swatchOf({ name: 'Sick Leave' })).toContain('--leave-sick');
    expect(swatchOf({ name: 'Earned Leave' })).toContain('--leave-earned');
    expect(swatchOf({ name: 'Comp off' })).toContain('--leave-compoff');
    expect(swatchOf({ name: 'Work from home' })).toContain('--leave-wfh');
    expect(swatchOf({ name: 'Maternity Leave' })).toMatch(/^rgb\(var\(--leave-[0-7]\)\)$/);
  });
  it("a colour the old presets stored is nobody's pick; one the owner picked wins; the picker still gets a hex", () => {
    expect(swatchOf({ name: 'Casual Leave', color: '#2563eb' })).toContain('--leave-casual');
    expect(swatchOf({ name: 'Casual Leave', color: '#123456' })).toBe('#123456');
    expect(colorOf({ name: 'Casual Leave' })).toMatch(/^#[0-9A-F]{6}$/);
  });
  it('the policy presets store no colour, and tags pick from the categorical series', () => {
    expect(read('packages/ui/src/timeOff/LeavePolicy.jsx')).not.toMatch(/color: '#/);
    expect(read('apps/people/src/screens/Tags.jsx')).toContain("const SWATCHES = ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4', '#008300', '#6250D6', '#E34948'];");
  });
});
