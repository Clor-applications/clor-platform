import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PermissionContext } from '@ui/permissions/context';
import Directory from './Directory';

/*
 * Design audit, 4 Nov 2026, blocker 6: on a phone the first person on Employees started 640px down. Import and
 * Export go behind a ⋮ beside Add employee, the figures leave out their zeros, Filters is an icon button beside
 * search, and the joiners line is short. The desktop keeps its buttons and words (the CSS shows one or the other).
 */
vi.mock('./api', () => ({
  bulkUpdate: vi.fn(), changeImpact: vi.fn(), deleteView: vi.fn(), downloadText: vi.fn(), employeeIds: vi.fn(), exportColumns: vi.fn().mockResolvedValue([]), exportEmployees: vi.fn(),
  listContractors: vi.fn().mockResolvedValue([]), listTags: vi.fn().mockResolvedValue([]), listViews: vi.fn().mockResolvedValue([]), saveView: vi.fn(), structure: vi.fn().mockResolvedValue({}),
  dataHealth: vi.fn().mockResolvedValue({ checks: [] }),
  openChecklistTasks: vi.fn().mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ kind: 'JOINING', employee: { id: `e${i}` } }))),
  employeeCounts: vi.fn().mockResolvedValue({ total: 12, joining: 0, joinedThisMonth: 0, leftThisMonth: 0, onNotice: 0, onLeave: 0, monthStart: '2026-11-01' }),
  listEmployees: vi.fn().mockResolvedValue({ employees: [{ id: 'e1', name: 'Priya Sharma', status: 'ACTIVE' }], total: 1 }),
  workforcePending: vi.fn().mockResolvedValue({ requests: [], scheduled: [], invites: [], drafts: [] }),
}));
vi.mock('../organization/api', () => ({ listBranches: vi.fn().mockResolvedValue([]) }));
vi.mock('@ui/personnel/Employees', () => ({ Avatar: () => null }));

const owner = (ui) => <PermissionContext.Provider value={{ loading: false, isAdmin: true, permissions: new Set() }}>{ui}</PermissionContext.Provider>;

describe('Employees on a phone', () => {
  it('offers Import and Export behind a ⋮ that only the phone shows', async () => {
    const openScreen = vi.fn();
    render(owner(<Directory params={{}} updateParams={vi.fn()} openScreen={openScreen} />));
    const more = await screen.findByRole('button', { name: 'More: import or export' });
    expect(more.closest('.people-phone-only')).toBeTruthy();
    for (const name of [/^Import$/, /^Export$/]) expect(screen.getByRole('button', { name }).className).toMatch(/people-desktop-only/);
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import employees' }));
    expect(openScreen).toHaveBeenCalledWith('employeeImport');
  });

  it('marks the figures at nought, so the phone strip can leave them out', async () => {
    render(owner(<Directory params={{}} updateParams={vi.fn()} openScreen={vi.fn()} />));
    const strip = await screen.findByRole('list', { name: 'Workforce counts' });
    expect(strip.querySelectorAll('[data-zero]').length).toBe(5);
    expect(strip.closest('.people-figures-scroll')).toBeTruthy();
  });

  it('keeps Filters a named button with a short label, and the joiners line short on a phone', async () => {
    render(owner(<Directory params={{}} updateParams={vi.fn()} openScreen={vi.fn()} />));
    const filters = await screen.findByRole('button', { name: /Filters/ });
    expect(filters.className).toMatch(/people-filters-btn/);
    expect(within(filters).getByText('Filters').className).toMatch(/people-desktop-only/);
    const line = await screen.findByRole('list', { name: 'Needs attention' });
    expect(within(line).getByText('12 joiners').className).toMatch(/people-phone-only/);
    expect(within(line).getByText('12 joiners with joining steps open').className).toMatch(/people-desktop-only/);
  });
});
