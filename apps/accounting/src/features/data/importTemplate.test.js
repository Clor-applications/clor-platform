/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { describe, expect, it } from 'vitest';

import { narrowTemplate } from './ImportCenter';

/**
 * The template carries the columns that were asked for.
 *
 * Every column on every template is a spreadsheet somebody has to prune before
 * they can start, and the columns they do not need are the ones they fill in
 * wrongly.
 */
const TEMPLATE = ['entry_ref,date,account_code,debit,credit,description', 'JV-1,2026-04-01,1001,1000,0,Opening'].join('\n');

describe('narrowing a template', () => {
  it('keeps only the chosen columns, in the template\'s own order', () => {
    const out = narrowTemplate(TEMPLATE, ['date', 'entry_ref', 'debit']);
    expect(out.split('\n')[0]).toBe('entry_ref,date,debit');
    expect(out.split('\n')[1]).toBe('JV-1,2026-04-01,1000');
  });

  it('leaves the file alone when everything is chosen', () => {
    const all = ['entry_ref', 'date', 'account_code', 'debit', 'credit', 'description'];
    expect(narrowTemplate(TEMPLATE, all)).toBe(TEMPLATE);
  });

  /* A file with no columns is not a narrower file, it is a broken one. */
  it('leaves the file alone when nothing is chosen', () => {
    expect(narrowTemplate(TEMPLATE, [])).toBe(TEMPLATE);
    expect(narrowTemplate(TEMPLATE, ['not_a_column'])).toBe(TEMPLATE);
  });

  it('keeps the sample row aligned with the header it belongs to', () => {
    const out = narrowTemplate(TEMPLATE, ['description']);
    expect(out).toBe('description\nOpening');
  });
});
