import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  branchId,
  companyStorageKey,
  selectBranch,
  selectWarehouse,
  selectedBranchId,
  selectedWarehouseId,
  setPlatformContext,
  warehouseId,
} from './context';
import { apiFetch } from './http';
import { getLastSelection, setLastSelection } from '@ui/utils/lastSelection';

/*
 * A-23: branch and warehouse lived in two browser-wide keys while the company
 * was per tab, so a second tab switching company made this one send the other
 * company's warehouse and number from the other company's branch series.
 * A-28: a few remembered choices were not per company either.
 */

const inCompany = (orgId, defaultBranch = `${orgId}-main`) => setPlatformContext({ orgId, branchId: defaultBranch, warehouseId: '' });

/** A second tab: same browser storage (localStorage), its own sessionStorage. */
const newTab = () => sessionStorage.clear();

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('the branch and warehouse a tab works in', () => {
  it('belong to the company they were chosen in', () => {
    inCompany('org-x');
    selectBranch('x-branch-2');
    selectWarehouse('x-store');
    inCompany('org-y');
    expect(selectedBranchId()).toBe('');
    expect(selectedWarehouseId()).toBe('');
    expect(branchId()).toBe('org-y-main');
    expect(warehouseId()).toBe('');
  });

  it('are not moved by another tab choosing differently', () => {
    inCompany('org-x');
    selectBranch('x-branch-2');
    const mine = sessionStorage.getItem('clor.sel.org-x.branch');
    newTab();
    selectBranch('x-branch-3');
    /* Back in the first tab: its own session still holds its choice. */
    sessionStorage.setItem('clor.sel.org-x.branch', mine);
    expect(selectedBranchId()).toBe('x-branch-2');
  });

  it("start a new tab from this company's last choice in this browser", () => {
    inCompany('org-x');
    selectWarehouse('x-store');
    newTab();
    expect(selectedWarehouseId()).toBe('x-store');
  });

  it('are what requests carry, not a key another company wrote', async () => {
    localStorage.setItem('activeWarehouseId', 'y-store'); // the old shared key, left by another tab
    inCompany('org-x');
    selectBranch('x-branch-2');
    const fetch = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    await apiFetch('/ping');
    const headers = fetch.mock.calls[0][1].headers;
    expect(headers['x-org-id']).toBe('org-x');
    expect(headers['x-branch-id']).toBe('x-branch-2');
    expect(headers['x-warehouse-id']).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe('choices remembered per company (A-28)', () => {
  it('keeps the last-used branch on a form apart between companies with the same local record', () => {
    inCompany('org-x');
    setLastSelection('branch', 'company-1', 'x-branch-2');
    inCompany('org-y');
    expect(getLastSelection('branch', 'company-1')).toBe('');
  });

  it('names per-company keys after the company', () => {
    inCompany('org-x');
    expect(companyStorageKey('dashboardBranchIds')).toBe('clor.org-x.dashboardBranchIds');
  });
});
