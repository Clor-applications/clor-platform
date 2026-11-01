/**
 * One HTML escape for the server (dedup batch 7). Five copies escaped the
 * same five characters; the API docs page escaped four (no apostrophe) and now
 * shares the stricter one. A browser reads &#39; back as an apostrophe, so the
 * page reads the same.
 */
import { describe, expect, it } from 'vitest';

import { escapeHtml } from '../utils/html.js';
import { inr } from '../utils/money.js';
import { OPENAPI, docsHtml } from '../services/attendance/openapi.js';

describe('escapeHtml', () => {
  it('escapes the five characters and nothing else', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a> ₹5`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt; ₹5');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });

  it('gives what the five-character copies gave, character for character', () => {
    const copy = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    for (const v of [`O'Brien "Steel" & <Sons>`, '', 'plain', null, 7]) expect(escapeHtml(v)).toBe(copy(v));
  });

  it('keeps the API docs page whole: only an apostrophe is now written as &#39;', () => {
    const fourChar = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const page = docsHtml(OPENAPI);
    expect(page).toContain(`<title>${escapeHtml(OPENAPI.info.title)}</title>`);
    expect(page).toContain(fourChar(OPENAPI.info.title));
    /* Where the spec's own words carry an apostrophe, the page carries the entity. */
    const withApostrophe = { ...OPENAPI, info: { ...OPENAPI.info, title: "Kaveri's API" } };
    expect(docsHtml(withApostrophe)).toContain('<title>Kaveri&#39;s API</title>');
  });
});

describe('inr', () => {
  it('shows rupees with Indian grouping, at the paisa', () => {
    expect(inr(123456.5)).toBe('₹1,23,456.5');
    expect(inr(1.005)).toBe('₹1.01');
    expect(inr(8000)).toBe('₹8,000');
  });
});
