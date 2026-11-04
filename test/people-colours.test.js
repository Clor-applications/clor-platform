import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { colorOf, swatchOf } from '../packages/ui/src/timeOff/api';

/**
 * People's brand colours used where they belong (owner, 31 Oct 2026: "yellow and other colors not utilised
 * properly", then "Yes, all ten"; red brand from 3 Nov 2026). Marigold marks what waits on you, blush what is chosen or done, away has its
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
const OXBLOOD = '92 10 22';
const MARIGOLD = '245 166 35';

describe('counts that wait on you are marigold', () => {
  it('styles the count class the tabs render, not one that does not exist', () => {
    expect(people).not.toMatch(/\.ui-tab \.ui-count|\.ui-split-panel \.ui-count/);
    expect(people).toMatch(/:is\(\.ui-tab-count, \.ui-side-count\)\[data-tone='warn'\] \{ background: rgb\(var\(--warm\)\) !important; color: rgb\(var\(--oxblood\)\) !important;/);
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
    expect(block).toMatch(/\.ui-bell-count \{ background: rgb\(var\(--warm\)\); color: rgb\(var\(--oxblood\)\); \}/);
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
  it('oxblood figures leave a nought to the quiet grey rule', () => {
    const indigo = people.match(/^.*#main-content :is\(h1, [^{]*\{ color: rgb\(var\(--fg-heading\)\); \}$/m)[0];
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
    const report = Object.fromEntries(tintsIn(read('apps/people/src/screens/PeopleReports.jsx')));
    expect(report).toMatchObject({ 'Headcount today': 'sky', Joiners: 'mint', Leavers: 'peach', Attrition: 'lilac' });
    expect(read('packages/ui/src/components/list/ListPageParts.jsx')).toMatch(/data-tint=\{card\.tint \|\| undefined\}/);
  });
  it('every quick link in People names a tint, and marigold only for Approvals', () => {
    const panels = read('apps/people/src/panels.jsx');
    const links = [...panels.matchAll(/\{ label: '([^']+)', icon: \w+,(?: screen: '\w+',)?( tint: '(\w+)',)? onClick/g)];
    expect(links.length).toBeGreaterThan(40);
    for (const [, label, , tint] of links) {
      expect(tint, label).toMatch(/^(sky|mint|peach|lilac|butter)$/);
      expect(tint === 'butter', label).toBe(label === 'Approvals');
    }
    for (const [, label, tint] of panels.matchAll(/\['([^']+)', \w+, '\w+', '(\w+)'\]/g)) expect(tint, label).not.toBe('butter');
  });
  it.each([
    'apps/people/src/workforce/Directory.jsx',
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
  it('a department has one tint on every Organisation screen, from its name, never marigold', async () => {
    const { tintOf, ORG_TINTS } = await import('../apps/people/src/organization/tints.js');
    expect(ORG_TINTS).not.toContain('butter');
    for (const name of ['Sales', 'Production', 'Accounts', 'Human resources', 'Management', 'Head Office']) {
      expect(ORG_TINTS).toContain(tintOf(name));
      expect(tintOf(name)).toBe(tintOf(` ${name.toUpperCase()} `));
    }
    for (const f of ['apps/people/src/organization/Overview.jsx', 'apps/people/src/organization/StructurePage.jsx', 'apps/people/src/screens/OrgTreeChart.jsx']) {
      const src = read(f);
      expect(src, f).toMatch(/import \{ tintOf \} from '(\.\/|\.\.\/organization\/)tints'/);
      expect(src, f).not.toMatch(/'butter'/);
    }
    expect(read('apps/people/src/organization/Overview.jsx')).toMatch(/data-tint=\{tintOf\(x\.name\)\}/);
    expect(people).toMatch(/\.org-card-bar > span \{ background: rgb\(var\(--tint-ink, var\(--fg-muted\)\)\); \}/);
    expect(people).not.toMatch(/\.org-card-bar > span \{ background: rgb\(var\(--warm\)\); \}/);
    expect(read('apps/people/src/organization/StructurePage.jsx')).toMatch(/data-tint=\{tintOf\(r\.name\)\}/);
    expect(read('apps/people/src/screens/OrgTreeChart.jsx')).toMatch(/\[d, tintOf\(d\)\]/);
  });
  it('Home: Waiting for you is the marigold panel; news, events and celebrations are not marigold', () => {
    const home = read('apps/people/src/screens/PeopleOverview.jsx');
    expect(home).toMatch(/id="todo-h" icon=\{SealCheck\} tint="butter"/);
    expect((home.match(/tint="butter"|'butter'/g) || [])).toHaveLength(1);
    expect(people).not.toMatch(/\.people-celebrate-badge \{ background: rgb\(var\(--butter/);
    expect(people).not.toMatch(/\.soft-(fun|event\[data-fun\])[^{]*\{[^}]*--butter/);
    expect(people).not.toMatch(/\.soft-news-icon\[data-symbol\] \{[^}]*--butter/);
  });
  it('faces hash over four washes, none marigold, and the record keeps the person\'s own', () => {
    expect(read('packages/ui/src/personnel/Employees.jsx')).toMatch(/% 9973, 0\) % 4\}/);
    expect(people).not.toMatch(/data-hue='4'/);
    expect(people).not.toMatch(/\.ui-avatar-initials\[data-hue='\d'\] \{[^}]*--butter/);
    expect(people).not.toMatch(/\.ui-profile \.ui-avatar-initials \{ background: rgb\(var\(--marigold\)\)/);
  });
  it('every figure strip names its tints, Data health\'s gaps clay', () => {
    expect(read('packages/ui/src/personnel/DataHealth.jsx').match(/className="ui-metric" data-tint="peach"/g)).toHaveLength(2);
    for (const f of ['apps/people/src/workforce/ImportEmployees.jsx', 'apps/people/src/workforce/Directory.jsx', 'packages/ui/src/personnel/DataHealth.jsx']) {
      expect(read(f), f).not.toMatch(/<div className="ui-metric"(?! data-tint)[ >]/);
    }
    expect(read('packages/ui/src/timeOff/YearEnd.jsx')).toMatch(/\['lapse', 'Lapses', lapses, 'peach'\]\][\s\S]*role="listitem" data-tint=\{tint\}/);
  });
});

describe('status tokens in brand D', () => {
  it('warnings: marigold marks, words in a readable warm ink, never marigold text', () => {
    expect(token(block, 'warn-mark')).toBe(MARIGOLD);
    expect(token(block, 'warn')).not.toBe(MARIGOLD);
    expect(contrast(token(block, 'warn'), WHITE)).toBeGreaterThan(4.5);
    expect(token(block, 'warn-soft')).toBe('254 241 214');
    expect(contrast(OXBLOOD, token(block, 'warn-soft'))).toBeGreaterThan(4.5);
    expect(block).toMatch(/\.ui-attention-dot\.is-warn \{ background: rgb\(var\(--warn-mark\)\); \}/);
  });

  it("red is DESIGN's #B91C1C, readable on white and on its soft tint", () => {
    expect(token(block, 'neg')).toBe('185 28 28');
    expect(contrast(token(block, 'neg'), WHITE)).toBeGreaterThan(4.5);
    expect(contrast(token(block, 'neg'), token(block, 'neg-soft'))).toBeGreaterThan(4.5);
  });

  it('away has its own mark, apart from Present\'s oxblood, and is never text', () => {
    expect(token(block, 'away')).toBe('168 110 124');
    expect(contrast(token(block, 'away'), WHITE)).toBeGreaterThan(3);
    expect(contrast(token(block, 'away'), OXBLOOD)).toBeGreaterThan(3);
    expect(block).toMatch(/\.att-summary \[data-tone='info'\] \{ --t: var\(--away\); \}/);
    expect(block).not.toMatch(/color: rgb\(var\(--away\)\)/);
  });

  it('a clash is a look-here line, not an error', () => {
    expect(read('apps/people/src/panels.jsx')).toContain('<SideAlert key={`c-${c.dept}`} tone="warn"');
    expect(block).toMatch(/\.ui-side-alert\[data-tone='warn'\] \{ box-shadow: inset 3px 0 0 rgb\(var\(--warm\)\); \}/);
  });

  it('oxblood on marigold, the one way marigold carries words, clears AA', () => {
    expect(contrast(OXBLOOD, MARIGOLD)).toBeGreaterThan(4.5);
    expect(contrast(MARIGOLD, WHITE)).toBeLessThan(3);
  });
});

describe('one brand series for charts, teams and leave types', () => {
  it('teams: oxblood, marigold, away first; no-team stays grey', () => {
    expect(token(block, 'dept-1')).toBe(OXBLOOD);
    expect(token(block, 'dept-2')).toBe(MARIGOLD);
    expect(token(block, 'dept-3')).toBe('168 110 124');
    expect(token(block, 'dept-0')).toBe('116 104 108');
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

  it('faces: initials in oxblood on their team wash', () => {
    expect(block).toMatch(/\.people-face \{ color: rgb\(var\(--oxblood\)\); background: rgb\(var\(--dept\) \/ 0\.16\); \}/);
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
  /* Since 3 Nov 2026 the panel is blush under an oxblood rail (test/people-red-brand.test.js): the open screen is a white tile with a red edge. */
  it("the module panel's open screen sits on a white tile, marked with red", () => {
    expect(block).toMatch(/\.ui-split-panel \.ui-split-item\[aria-current='page'\] \{\n\s*background: rgb\(255 255 255\); color: rgb\(var\(--brand-ink\)\); font-weight: 700; box-shadow: inset 3px 0 0 rgb\(var\(--red\)\)/);
  });

  it("the employee app wears brand D's waiting through its own data-brand, not the sky palette", () => {
    const portal = read('apps/attendance/src/portal/EmployeePortal.jsx');
    expect(portal).toContain('className="ui-portal min-h-dvh pb-20" data-brand="d"');
    expect(portal).not.toMatch(/data-palette/);
    const rules = block.slice(block.indexOf('The employee app'));
    expect(rules).toMatch(/\.ui-portal\[data-brand='d'\] \.ui-pill-warn \{ background: rgb\(var\(--marigold\)\); color: rgb\(var\(--oxblood\)\); \}/);
    for (const line of rules.split('\n').filter((l) => l.includes('{'))) expect(line).toContain(".ui-portal[data-brand='d']");
  });
});
