import { describe, it, expect } from 'vitest';

import { appAddress, chooseTenant, frontDoorForward, orgCodeFromPath, withOrgPath, withoutOrgPath } from './orgUrl';

const A = { id: 'org-a', code: 'KAVE-C100' };
const B = { id: 'org-b', code: 'KAVE-C101' };
const tenants = [A, B];

describe('the company in the address', () => {
  it('is read from /o/<code>, whatever the case, and only from the start of the path', () => {
    expect(orgCodeFromPath('/o/KAVE-C100/')).toBe('KAVE-C100');
    expect(orgCodeFromPath('/o/kave-c101')).toBe('KAVE-C101');
    expect(orgCodeFromPath('/o/KAVE-C100/verify-email')).toBe('KAVE-C100');
    expect(orgCodeFromPath('/')).toBe('');
    expect(orgCodeFromPath('/docs/o/KAVE-C100')).toBe('');
    expect(orgCodeFromPath('/o/')).toBe('');
  });

  it('is written in front of the rest of the path, replacing any code already there', () => {
    expect(withOrgPath('/', 'KAVE-C100')).toBe('/o/KAVE-C100/');
    expect(withOrgPath('/o/KAVE-C100/', 'KAVE-C101')).toBe('/o/KAVE-C101/');
    expect(withOrgPath('/verify-email', 'kave-c100')).toBe('/o/KAVE-C100/verify-email');
    expect(withOrgPath('/o/KAVE-C100', '')).toBe('/');
    expect(withoutOrgPath('/o/KAVE-C100/x')).toBe('/x');
  });
});

describe('which company a tab opens', () => {
  it('follows the address first, over this tab and the browser', () => {
    expect(chooseTenant({ tenants, urlCode: 'KAVE-C101', tabChoice: 'org-a', lastUsed: 'org-a' }).tenant).toBe(B);
  });

  it('never opens another company for a code that is not one of yours', () => {
    const r = chooseTenant({ tenants, urlCode: 'ZZZZ-C100', tabChoice: 'org-a', lastUsed: 'org-a', suggested: 'org-a' });
    expect(r.tenant).toBeNull();
    expect(r.denied).toBe('ZZZZ-C100');
  });

  it("keeps this tab's company when another tab used a different one last", () => {
    expect(chooseTenant({ tenants, tabChoice: 'org-a', lastUsed: 'org-b' }).tenant).toBe(A);
  });

  it('opens the last-used company in a new tab with no address, then the suggestion, then the first', () => {
    expect(chooseTenant({ tenants, lastUsed: 'org-b' }).tenant).toBe(B);
    expect(chooseTenant({ tenants, suggested: 'org-b' }).tenant).toBe(B);
    expect(chooseTenant({ tenants }).tenant).toBe(A);
    expect(chooseTenant({ tenants: [] }).tenant).toBeNull();
  });

  it('opens a company just created even when the address names another', () => {
    expect(chooseTenant({ tenants, urlCode: 'KAVE-C100', suggested: 'org-b', preferSuggested: true }).tenant).toBe(B);
  });
});

describe('crossing to another app’s address (A-25)', () => {
  it('carries the company to the other host', () => {
    expect(appAddress({ host: 'payroll.clor.in', code: 'KAVE-C101', search: '?open=runs' })).toBe('https://payroll.clor.in/o/KAVE-C101/?open=runs');
  });

  it('forwards from the front door with the company, ?open= and #/screen', () => {
    expect(frontDoorForward({ host: 'accounting.clor.in', pathname: '/o/KAVE-C101/', search: '?open=invoices', hash: '#/invoices', code: 'KAVE-C100' })).toBe(
      'https://accounting.clor.in/o/KAVE-C101/?open=invoices#/invoices'
    );
    expect(frontDoorForward({ host: 'accounting.clor.in', pathname: '/', code: 'KAVE-C100' })).toBe('https://accounting.clor.in/o/KAVE-C100/');
  });
});
