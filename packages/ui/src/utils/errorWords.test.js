import { describe, expect, it } from 'vitest';
import { dayText, enumWords, errorWords, monthText, plural, subscriptionSentence, subscriptionWord } from './errorWords.js';

describe('errorWords', () => {
  it('keeps a plain server sentence', () => {
    expect(errorWords(new Error('No such shift'), 'save the shift')).toBe('No such shift.');
  });
  it('replaces developer text with the action and a next step', () => {
    expect(errorWords(new Error('orgId mismatch'), 'save the shift')).toBe('Could not save the shift. Try again.');
    expect(errorWords(new Error('Validation error: Invalid input: expected string'), 'save')).toBe('Could not save. Try again.');
    expect(errorWords(new Error('APP_NOT_SUBSCRIBED'), 'open it')).toBe('Could not open it. Try again.');
    expect(errorWords(undefined, 'load the pay runs')).toBe('Could not load the pay runs. Try again.');
  });
  it('uses the code when there is one', () => {
    expect(errorWords(Object.assign(new Error('x'), { code: 'APP_NOT_SUBSCRIBED' }))).toMatch(/not on your plan/);
  });
  it('says the connection dropped', () => {
    expect(errorWords(Object.assign(new Error('Failed to fetch'), { network: true }))).toMatch(/could not be reached/);
  });
  it('adds the reference when the server gave one', () => {
    expect(errorWords(Object.assign(new Error('Server error'), { status: 500, requestId: 'r-1' }), 'save')).toBe(
      'Could not save. Try again. If it happens again, tell CLOR support the reference r-1.',
    );
  });
});

describe('words for values', () => {
  it('subscription status', () => {
    expect(subscriptionSentence('past_due')).toMatch(/overdue/);
    expect(subscriptionWord('trialing')).toBe('Free trial');
    expect(subscriptionWord('weird')).toBe('Needs attention');
  });
  it('enums, dates, plurals', () => {
    expect(enumWords('PENDING_APPROVAL')).toBe('Pending approval');
    expect(dayText('2026-11-14')).toBe('14 Nov 2026');
    expect(monthText('2026-11')).toBe('November 2026');
    expect(plural(1, 'day')).toBe('1 day');
    expect(plural(0, 'day')).toBe('0 days');
  });
});
