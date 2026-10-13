import { describe, expect, it, afterEach, vi } from 'vitest';

import { formatDateIn, localDateIso, parseDateIn, todayIso } from './dates';

/**
 * A date that means the same thing on every machine.
 *
 * Seven places rendered accounting dates with a naked `toLocaleDateString()`,
 * which asks the browser what shape a date is. On a US-locale machine a trial
 * balance dated 2026-12-09 printed as 12/9/2026 — read by an Indian
 * book-keeper as the twelfth of September. The number was right and the day
 * was three months out.
 *
 * So the rule these tests hold: the display format is the product's, not the
 * visitor's. `09/12/2026` is the ninth of December wherever it is read.
 */

describe('formatDateIn', () => {
  it('reads an ambiguous date the Indian way, not the American one', () => {
    /* The two dates that swap meaning between the conventions — if one test
       survives a refactor, it should be this one. */
    expect(formatDateIn('2026-12-09')).toBe('09/12/2026');   // 9 December
    expect(formatDateIn('2026-09-12')).toBe('12/09/2026');   // 12 September
  });

  it('does not agree with the US rendering of the same day', () => {
    /* Proves the output is ours rather than the platform's: if someone swaps
       the helper back for a locale call, these stop differing. */
    const us = new Date('2026-12-09T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC' });
    expect(us).toBe('12/9/2026');
    expect(formatDateIn('2026-12-09')).not.toBe(us);
  });

  it('takes the date out of a timestamp without a Date in the middle', () => {
    expect(formatDateIn('2026-12-09T18:30:00.000Z')).toBe('09/12/2026');
  });

  it('hands back anything it cannot read, rather than throwing', () => {
    /* Callers rely on this: the period label dropped its try/catch because
       there is nothing left to catch. */
    for (const junk of [null, undefined, '', 'not a date', '09/12/2026']) {
      expect(() => formatDateIn(junk)).not.toThrow();
    }
    expect(formatDateIn(null)).toBe('');
    expect(formatDateIn('not a date')).toBe('not a date');
  });

  it('round-trips with parseDateIn', () => {
    expect(parseDateIn(formatDateIn('2026-12-09'))).toBe('2026-12-09');
  });
});

describe('localDateIso', () => {
  afterEach(() => vi.useRealTimers());

  it('gives the day the reader is living, not the one in Greenwich', () => {
    /* 2am on the 13th in Delhi is still the 12th in UTC. A report headed
       "As of" must say the thirteenth. */
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T20:30:00.000Z')); // 02:00 IST, 13 Sep
    const local = new Date();
    expect(localDateIso()).toBe(
      `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
    );
    /* And it is genuinely the local calendar day, not a UTC slice. */
    expect(localDateIso()).toBe(`${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`);
  });

  it('accepts a timestamp string, a Date, or nothing at all', () => {
    const d = new Date('2026-12-09T10:00:00.000Z');
    expect(localDateIso(d)).toBe(localDateIso(d.toISOString()));
    expect(localDateIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is empty for a date that is not one', () => {
    expect(localDateIso('never')).toBe('');
    expect(localDateIso(null)).toBe('');
  });

  it('feeds formatDateIn, which is how every reader-facing date is built', () => {
    expect(formatDateIn(localDateIso(new Date('2026-12-09T10:00:00.000Z')))).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe('todayIso stays UTC', () => {
  it('is not quietly turned into the local date', () => {
    /* The two helpers answer different questions and both are needed:
       `todayIso` matches what the server stores for a form default,
       `localDateIso` matches the wall the reader is looking at. */
    expect(todayIso()).toBe(new Date().toISOString().slice(0, 10));
  });
});
