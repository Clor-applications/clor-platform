import { describe, expect, it } from 'vitest';
import { HELP_GROUPS, HELP_TOPICS, searchHelp } from './helpContent';

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
    expect(searchHelp('invite').map((t) => t.key)).toEqual(expect.arrayContaining(['setup', 'people']));
    expect(searchHelp('tally').map((t) => t.key)).toContain('tally');
    expect(searchHelp('zzzz')).toEqual([]);
  });
});
