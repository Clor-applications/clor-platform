/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { FEATURE_GROUPS, groupForFeature, settingsLinkFor, groupMeta } from './featureRegistry';

/**
 * The Features screen groups the way the business thinks.
 *
 * What this holds is the thing that rots: the grouping is a view over a
 * catalogue that lives on the server, so a feature added there must land
 * somewhere on this screen without anyone remembering to edit two files.
 */

const catalogKeys = () => {
  const src = readFileSync('server/src/constants/featureCatalog.ts', 'utf8');
  return [...src.matchAll(/^\s*key: '([^']+)',$/gm)].map((m) => m[1]);
};

describe('the groups', () => {
  it('are the ones the setting-up conversation actually has', () => {
    /* Wider than the six on the original list, because the catalogue holds
       capabilities that list never mentioned — reconciliation, period lock,
       approvals — and a capability with nowhere to sit is a capability nobody
       can switch. */
    expect(FEATURE_GROUPS.map((g) => g.label)).toEqual([
      'Organisation',
      'General',
      'Sales',
      'Purchases & Expenses',
      'Inventory',
      'Cash & Bank',
      'Accounting',
      'Payroll',
      'Taxation',
      'Users & Permissions',
      'Notifications',
      'Other',
    ]);
  });

  it('carries no description under a heading', () => {
    /* House rule: a line under "Sales" saying it holds sales features is
       noise. The group's own name is the whole explanation. */
    for (const g of FEATURE_GROUPS) {
      expect(g.blurb).toBeUndefined();
      expect(groupMeta(g.key)).toBe(g);
    }
  });
});

describe('every feature lands somewhere', () => {
  it('assigns a group to each key in the server catalogue', () => {
    const keys = catalogKeys();
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) {
      expect(FEATURE_GROUPS.map((g) => g.key)).toContain(groupForFeature(k));
    }
  });

  it('falls to Other rather than vanishing, for a key added on the server alone', () => {
    /* The whole reason for a default: a capability shipped on the server
       before anyone edits this file must still be switchable. */
    expect(groupForFeature('somethingAddedLater')).toBe('other');
    expect(groupForFeature('')).toBe('other');
  });

  it('puts the organisation-shaping switches in Organisation', () => {
    for (const k of ['branches', 'warehouses', 'multiCurrency']) {
      expect(groupForFeature(k)).toBe('organisation');
    }
  });

  it('puts each document with the side of the book that raises it', () => {
    for (const k of ['pos', 'estimates', 'salesOrders', 'recurringInvoices', 'deliveryChallans']) {
      expect(groupForFeature(k)).toBe('sales');
    }
    for (const k of ['purchaseOrders', 'debitNotes', 'expenses']) {
      expect(groupForFeature(k)).toBe('purchases');
    }
    for (const k of ['batchSerial', 'batchExpiry', 'reorderAlerts', 'stockTransfers']) {
      expect(groupForFeature(k)).toBe('inventory');
    }
  });
});

describe('the switches that need somewhere to go next', () => {
  it('sends the three organisation switches to their own screen', () => {
    for (const [key, target] of [
      ['branches', 'settingsBranches'],
      ['warehouses', 'settingsWarehouses'],
      ['multiCurrency', 'settingsCurrencies'],
    ]) {
      const link = settingsLinkFor(key);
      expect(link).toBeTruthy();
      expect(link.key).toBe(target);
      expect(link.label.length).toBeGreaterThan(4);
    }
  });

  it('names a screen that actually exists', () => {
    /* A link to a screen the router does not know is a dead end, and nothing
       else would catch it. */
    const app = readFileSync('apps/accounting/src/App.jsx', 'utf8');
    for (const key of ['branches', 'warehouses', 'multiCurrency']) {
      expect(app).toContain(`case '${settingsLinkFor(key).key}':`);
    }
  });

  it('offers no link where turning the switch on is the whole job', () => {
    for (const k of ['pos', 'expenses', 'reorderAlerts', 'insights']) {
      expect(settingsLinkFor(k)).toBeNull();
    }
  });
});
