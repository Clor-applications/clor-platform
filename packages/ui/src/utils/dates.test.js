import { describe, expect, it, afterEach, vi } from 'vitest';

import { addDaysIso, formatDateIn, istDay, localDateIso, parseDateIn, plusDaysIso, todayIso, todayIst } from './dates';

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

describe("todayIso is India's date, as the server's todayIst", () => {
  afterEach(() => vi.useRealTimers());
  const at = (moment) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(moment)); };

  it('at 01:00 IST is already the new day (UTC is still on yesterday)', () => {
    at('2026-11-01T01:00:00+05:30');
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-10-31');
    expect(todayIso()).toBe('2026-11-01');
    expect(plusDaysIso(30)).toBe('2026-12-01');
  });

  it('at 23:30 IST on 31 December is still that year, and the next day is the new one', () => {
    at('2026-12-31T23:30:00+05:30');
    expect(todayIso()).toBe('2026-12-31');
    expect(plusDaysIso(1)).toBe('2027-01-01');
  });

  it('does not follow the machine’s own time zone', () => {
    /* `localDateIso` answers "the wall the reader is looking at"; `todayIso` is the business day in India, wherever the browser is. */
    at('2026-11-01T01:00:00+05:30');
    expect(todayIso()).toBe(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
  });
});

/* The shared IST helpers (dedup batch 6): every screen copy said the same thing. */
describe('todayIst, istDay and addDaysIso', () => {
  afterEach(() => vi.useRealTimers());

  it('today in India is todayIso, also between midnight and 05:30', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2027-01-01T02:00:00+05:30') });
    expect(todayIst()).toBe('2027-01-01');
    expect(todayIst()).toBe(todayIso());
  });

  it('puts a UTC timestamp on its day in India', () => {
    expect(istDay('2026-12-31T19:00:00Z')).toBe('2027-01-01');
    expect(istDay('2026-12-31T18:29:00Z')).toBe('2026-12-31');
    expect(istDay(new Date('2027-04-01T00:10:00+05:30'))).toBe('2027-04-01');
  });

  it('counts calendar days, across months and leap years', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDaysIso('2027-04-01', 0)).toBe('2027-04-01');
  });
});
