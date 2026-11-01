/**
 * The small helpers that each had several copies (dedup batches 3 and 7).
 * Each test pins the shared one to what the copies it replaced did.
 */
import { describe, expect, it } from 'vitest';

import { requireOrgId, setPlatformContext } from '@platform/context';
import { queryString } from '@platform/query';
import { escapeHtml } from './html';
import { GSTIN_RE, PAN_RE, isValidGstin, isValidPan } from './gstin';
import { rupees, wholeRupees } from './money';
import { can } from '../permissions/can';

describe('requireOrgId', () => {
  it('answers the company on screen, trimmed', () => {
    setPlatformContext({ orgId: ' 1234567890 ' });
    expect(requireOrgId()).toBe('1234567890');
  });

  it('refuses plainly when no company is chosen', () => {
    setPlatformContext({ orgId: '' });
    localStorage.removeItem('activeOrgId');
    expect(() => requireOrgId()).toThrow('Missing active org. Please select an organization.');
  });
});

describe('queryString', () => {
  it('leaves out what is not set and keeps the rest in order', () => {
    expect(queryString({ a: 1, b: '', c: null, d: undefined, e: 0, f: false, g: 'x y' })).toBe('?a=1&e=0&f=false&g=x+y');
  });

  it('is empty when nothing is set', () => {
    expect(queryString({})).toBe('');
    expect(queryString()).toBe('');
    expect(queryString(null)).toBe('');
  });
});

describe('escapeHtml', () => {
  it('escapes the five characters and nothing else', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a> ₹5`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt; ₹5');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(0)).toBe('0');
  });

  /*
   * The print windows in Inventory, Bills and Stock transfers escaped only
   * & < >. They now share the stricter escape. In text, a browser reads
   * &quot; and &#39; back as the same characters, so the page reads the same.
   */
  it('reads back in a page as the same text the three-character escape gave', () => {
    const old = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const shown = (html) => new DOMParser().parseFromString(`<table><tr><td>${html}</td></tr></table>`, 'text/html').querySelector('td').textContent;
    for (const v of [`O'Brien "Steel" & Sons`, '<b>Batch</b> 7', 'Plain', '', null, 12.5, `it's "₹5,000"`]) {
      expect(shown(escapeHtml(v))).toBe(shown(old(v)));
    }
  });
});

describe('PAN and GSTIN', () => {
  it('match the patterns the forms used', () => {
    expect(PAN_RE.source).toBe('^[A-Z]{5}[0-9]{4}[A-Z]$');
    expect(GSTIN_RE.source).toBe('^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
  });

  it('read a value trimmed and in capitals', () => {
    expect(isValidPan(' aabcu9603r ')).toBe(true);
    expect(isValidPan('AABCU9603')).toBe(false);
    expect(isValidPan(null)).toBe(false);
    expect(isValidGstin(' 29aabcu9603r1zm ')).toBe(true);
    expect(isValidGstin('29AABCU9603R0ZM')).toBe(false);
    expect(isValidGstin(undefined)).toBe(false);
  });
});

describe('rupees', () => {
  it('shows Indian grouping, up to two decimals', () => {
    expect(rupees(123456.5)).toBe('₹1,23,456.5');
    expect(rupees(1234.567)).toBe('₹1,234.57');
    expect(rupees(null)).toBe('₹0');
    expect(rupees('')).toBe('₹0');
  });

  it('shows whole rupees when asked', () => {
    expect(wholeRupees(123456.5)).toBe('₹1,23,457');
    expect(wholeRupees(undefined)).toBe('₹0');
  });
});

describe('can', () => {
  it('lets an admin through and otherwise asks the grant', () => {
    expect(can({ isAdmin: true }, 'x')).toBe(true);
    expect(can({ permissions: new Set(['x']) }, 'x')).toBe(true);
    expect(can({ permissions: new Set(['y']) }, 'x')).toBe(false);
    expect(can(null, 'x')).toBe(false);
  });
});
