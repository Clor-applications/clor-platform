// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { missingFor } from '../../../../scripts/i18n-strings.mjs';
import hi from './hi.js';
import { makeTranslator } from './translate.js';

/*
 * Round 67: the employee app in Hindi. Every line the employee app's code can
 * show has its Hindi (the list is read from the code itself, so a new English
 * line without Hindi fails here), and the translator turns lines with values,
 * dates and pieces the way a person would write them.
 */
describe('the Hindi file', () => {
  it('has every line of the employee app', async () => {
    const { missing, total } = await missingFor('hi');
    expect(total).toBeGreaterThan(1000);
    expect(missing).toEqual([]);
  });

  it('keeps every value: a Hindi line has as many holes as its English', () => {
    const wrong = Object.entries(hi.words).filter(([en, h]) => {
      const holes = en.split('{}').length - 1;
      const plain = (h.match(/\{\}/g) || []).length;
      const numbered = [...h.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
      return numbered.length ? new Set(numbered).size !== holes || Math.max(...numbered) !== holes || plain : plain !== holes;
    });
    expect(wrong).toEqual([]);
  });

  it('is Hindi: no line is left in English by mistake', () => {
    const english = Object.entries(hi.words).filter(([en, h]) => en === h && /[a-z]{3}/.test(en));
    expect(english).toEqual([]);
  });
});

describe('the translator', () => {
  const t = makeTranslator(hi);

  it('turns exact lines, lines with values and dates', () => {
    expect(t('Cancel leave')).toBe('छुट्टी रद्द करें');
    expect(t('Apply for Casual leave')).toBe('आकस्मिक छुट्टी के लिए आवेदन करें');
    expect(t('Apply for Night watch')).toBe('Night watch के लिए आवेदन करें');
    expect(t('3 of 12')).toBe('12 में से 3');
    expect(t('18 Nov 2026')).toBe('18 नव॰ 2026');
    expect(t('Thursday, 19 November')).toBe('गुरुवार, 19 नवंबर');
    expect(t('Left 2h 15m early')).toBe('2 घंटे 15 मिनट जल्दी गए');
    expect(t('Payslip for October 2026')).toBe('अक्टूबर 2026 की पेस्लिप');
  });

  it('turns a line made of pieces piece by piece', () => {
    expect(t('Fri: not yet')).toBe('शुक्र: अभी नहीं');
    expect(t('unpaid · half days allowed')).toBe('बिना वेतन · आधे दिन की छूट');
    expect(t('Why is Tue, 18 Nov present?')).toBe('मंगल, 18 नव॰ हाज़िर क्यों है?');
  });

  it('leaves names, codes and what people typed alone', () => {
    expect(t('Asha Rao')).toBeNull();
    expect(t('KT-007')).toBeNull();
    expect(t('09:30–18:30')).toBeNull();
    /* A one-word pattern ("{} day{}") never swallows a sentence it does not know. */
    expect(t('my brother’s wedding day is near')).toBeNull();
  });

  it('turns a server error by its code first, then by its words', () => {
    expect(t.error('Your app access is paused; please ask HR.', 'PORTAL_PAUSED')).toBe(hi.errors.PORTAL_PAUSED);
    expect(t.error('Your current password is not right.')).toBe('आपका मौजूदा पासवर्ड सही नहीं है।');
  });
});
