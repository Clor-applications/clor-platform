// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyCatalogue } from '../../website/src/catalogue.js';
import { PRODUCTS } from '../../website/src/site.js';
import { listingFor } from './appCatalogue';

/* The app catalogue CLOR staff keep in the operator console, as More apps and clor.in read it. */
const catalogue = [
  { code: 'books', appId: 'accounting', name: 'Books', status: 'AVAILABLE', blurb: 'Books, from the console.' },
  { code: 'people', appId: 'people', name: 'People', status: 'COMING_SOON', blurb: 'People line.' },
  { code: 'payroll', appId: 'payroll', name: 'Payroll', status: 'AVAILABLE', blurb: 'Payroll line.' },
  { code: 'attendance', appId: 'attendance', name: 'Attendance', status: 'AVAILABLE', blurb: 'Attendance line.' },
  { code: 'projects', appId: 'projects', name: 'Projects', status: 'COMING_SOON', blurb: 'Projects line.' },
];

describe('the app catalogue, read by the switcher and clor.in', () => {
  it('gives More apps each app’s listing, and calls an app the catalogue leaves out hidden', () => {
    expect(listingFor(null, 'people')).toBeNull();
    expect(listingFor(catalogue, 'people')).toMatchObject({ status: 'COMING_SOON', blurb: 'People line.' });
    expect(listingFor(catalogue, 'timesheet')).toEqual({ appId: 'timesheet', status: 'HIDDEN' });
  });

  it('takes hidden products off clor.in, marks coming soon, and uses the console’s line', () => {
    expect(applyCatalogue(PRODUCTS, null)).toBe(PRODUCTS);
    const shown = applyCatalogue(PRODUCTS, catalogue);
    expect(shown.map((p) => p.slug)).toEqual(['books', 'payroll', 'people', 'attendance', 'projects']);
    expect(shown.find((p) => p.slug === 'people')).toMatchObject({ status: 'soon', line: 'People line.' });
    expect(shown.find((p) => p.slug === 'books')).toMatchObject({ status: 'available', line: 'Books, from the console.' });
  });
});
