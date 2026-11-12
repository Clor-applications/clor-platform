import { describe, expect, it } from 'vitest';
import { HELP_GROUPS, HELP_TOPICS, searchHelp } from './helpContent';
import { GUIDES } from './helpGuides';
import { appById } from './registry';

const textOf = (t) => [t.title, t.summary, ...(t.sections || []).flatMap((s) => [s.heading, ...(s.points || []), ...(s.steps || [])])].join(' ');

describe('help centre content', () => {
  it('every topic belongs to a group, has a summary, and opens something or says something', () => {
    const groups = new Set(HELP_GROUPS.map((g) => g.key));
    for (const t of HELP_TOPICS) {
      expect(groups.has(t.group)).toBe(true);
      expect(t.summary.length).toBeGreaterThan(10);
      expect(Boolean(t.doc || (t.sections && t.sections.length))).toBe(true);
    }
    expect(new Set(HELP_TOPICS.map((t) => t.key)).size).toBe(HELP_TOPICS.length);
  });

  it('links guides as files, never as app addresses', () => {
    for (const t of HELP_TOPICS.filter((x) => x.doc)) expect(t.doc).toMatch(/^\/docs\/[a-z-]+\.html$/);
  });

  it('searches titles and text by every word typed', () => {
    expect(searchHelp('invite').map((t) => t.key)).toEqual(expect.arrayContaining(['setup', 'people', 'invite']));
    expect(searchHelp('tally').map((t) => t.key)).toContain('tally');
    expect(searchHelp('zzzz')).toEqual([]);
  });

  it('finds a guide by the words people search with, not only its title', () => {
    expect(searchHelp('regularise').map((t) => t.key)).toContain('missed-punch');
    expect(searchHelp('2fa').map((t) => t.key)).toContain('authenticator');
    expect(searchHelp('essl').map((t) => t.key)).toContain('connect-reader');
    expect(searchHelp('fnf').map((t) => t.key)).toContain('resignation-exit');
    expect(searchHelp('payable days').map((t) => t.key)).toContain('payroll-export');
  });
});

describe('the how-to guides', () => {
  it('cover Workspace, People and Attendance with at least twenty articles', () => {
    expect(GUIDES.length).toBeGreaterThanOrEqual(20);
    for (const group of ['guide-workspace', 'guide-people', 'guide-time']) expect(GUIDES.filter((g) => g.group === group).length).toBeGreaterThanOrEqual(5);
    for (const g of GUIDES) expect(HELP_TOPICS).toContain(g);
  });

  it('cover the first-week jobs', () => {
    const jobs = ['invite', 'who-sees-what', 'company-branches', 'add-employee', 'import-employees', 'shifts-weekly-off', 'holidays', 'connect-reader', 'phone-punch', 'employee-app', 'missed-punch', 'apply-leave', 'month-close', 'payroll-export', 'inbox', 'documents', 'offer-joining', 'resignation-exit', 'authenticator', 'support', 'billing-trial', 'export-close'];
    const keys = GUIDES.map((g) => g.key);
    for (const j of jobs) expect(keys, j).toContain(j);
  });

  /* An "Open" button that leads nowhere is worse than none: every link names a screen the app's manifest has. */
  it('link only to screens that exist', () => {
    const links = HELP_TOPICS.flatMap((t) => [t.open, t.alt].filter(Boolean).map((l) => ({ ...l, topic: t.key })));
    expect(links.length).toBeGreaterThan(30);
    for (const l of links) {
      const app = appById(l.app);
      expect(app, `${l.topic}: app ${l.app}`).toBeTruthy();
      expect(app.available, `${l.topic}: ${l.app} is built`).toBe(true);
      /* An empty screen opens the app where it lands. */
      if (l.screen !== '') expect(app.screens[l.screen], `${l.topic}: ${l.app}/${l.screen}`).toBeTruthy();
      expect(l.label.length).toBeGreaterThan(3);
    }
  });

  it('are written plainly: numbered steps, sentence case, CLOR in capitals', () => {
    for (const g of GUIDES) {
      expect(g.sections.some((s) => s.steps?.length), `${g.key} has numbered steps`).toBe(true);
      const text = textOf(g);
      expect(text, g.key).not.toMatch(/\bClor\b|\bclor\b(?!\.in)/);
      /* Titles in sentence case: only the first word, CLOR and proper names start with a capital. */
      const NAMES = new Set(['Inbox']); /* a menu's own name */
      const rest = g.title.split(' ').slice(1).filter((w) => /^[A-Z][a-z]/.test(w) && !NAMES.has(w));
      expect(rest, g.title).toEqual([]);
      /* Short sentences: nothing a reader has to read twice. */
      for (const line of g.sections.flatMap((s) => [...(s.points || []), ...(s.steps || [])])) {
        for (const sentence of line.split(/(?<=[.!?])\s+/)) expect(sentence.split(/\s+/).length, `${g.key}: ${sentence}`).toBeLessThanOrEqual(32);
      }
    }
  });
});
