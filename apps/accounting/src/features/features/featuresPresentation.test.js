import { describe, expect, it } from 'vitest';

import { FEATURES_PAGE_ROUTES, LANDING_ROUTE, featuresPresentationFor } from './featuresPresentation';

/**
 * Where you are decides which face Features shows. From the landing screen
 * and from the page itself, the page; from inside any working module, the
 * panel — list, form, detail, settings, report, all alike.
 */
describe('featuresPresentationFor', () => {
  it('is the page from Home and from the page itself', () => {
    expect(featuresPresentationFor(LANDING_ROUTE)).toBe('page');
    expect(featuresPresentationFor('features')).toBe('page');
    for (const alias of FEATURES_PAGE_ROUTES) expect(featuresPresentationFor(alias)).toBe('page');
    expect(featuresPresentationFor('')).toBe('page');
    expect(featuresPresentationFor(undefined)).toBe('page');
  });

  it('is the panel from every working module', () => {
    const modules = [
      'invoices',
      'newInvoice',
      'editInvoice',
      'customers',
      'purchaseBills',
      'bankCash',
      'expenses',
      'inventory',
      'journal',
      'reports',
      'trialBalance',
      'items',
      'settings',
      'settingsCompany',
      'pos',
    ];
    for (const route of modules) expect(featuresPresentationFor(route)).toBe('panel');
  });
});
