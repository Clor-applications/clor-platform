import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

/*
 * PR #80 QA by HR and the owner (30 Oct 2026): a row menu named by a database
 * id, a phone tick box too small to tap, the "Your company has grown" card one
 * word per line at 390px, and an announcement's "For" left blank.
 */
const ws = vi.hoisted(() => ({ listRecords: vi.fn(), saveRecord: vi.fn(), deleteRecord: vi.fn() }));
const people = vi.hoisted(() => ({
  listAllEmployees: vi.fn(async () => ({ employees: [] })),
  listBranches: vi.fn(async () => []),
  listStructure: vi.fn(async (kind) => (kind === 'departments' ? [{ id: 'd-sales', name: 'Sales' }] : [])),
  getPeopleSetup: vi.fn(async () => ({ setup: { show: false }, simpleMode: { suggest: true, reasons: ['12 people work here', '3 people sign in to CLOR'] } })),
  changePeopleSetup: vi.fn(),
}));
vi.mock('../apps/people/src/api/workspace', async (orig) => ({ ...(await orig()), ...ws }));
vi.mock('@ui/personnel/api', async (orig) => ({ ...(await orig()), ...people }));

import DataTable from '../packages/ui/src/components/ui/DataTable';
import WorkspaceList from '../apps/people/src/screens/WorkspaceList';
import HomeSetup from '../apps/people/src/screens/HomeSetup';
import { PermissionContext } from '../packages/ui/src/permissions/context';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('rows are named by their own words', () => {
  it('a branch row menu and tick box say the branch, never its id; the phone tick box has a 44px target', () => {
    const rows = [{ id: 'cmvv8g4l800my13n176n9035q', branchName: 'Mysuru works', branchCode: 'MYS' }];
    render(
      <DataTable
        label="Branches"
        columns={[{ key: 'name', label: 'Branch', render: (b) => b.branchName }]}
        rows={rows}
        selectable
        rowActions={() => [{ key: 'edit', label: 'Edit', onSelect: () => {} }]}
        card={(b) => b.branchName}
      />,
    );
    expect(screen.getAllByRole('button', { name: 'Actions for Mysuru works' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /cmvv8g/ })).toBeNull();
    const boxes = screen.getAllByRole('checkbox', { name: 'Choose Mysuru works' });
    const cardBox = boxes.find((b) => b.classList.contains('ui-card-check'));
    expect(cardBox.parentElement.classList.contains('ui-card-check-hit')).toBe(true);
  });
});

describe('Announcements: "For" names a department audience saved without its words', () => {
  it('shows Sales, not a dash', async () => {
    ws.listRecords.mockResolvedValue([{ id: 'n1', title: 'Sales target', status: 'PUBLISHED', employeeId: null, details: { body: 'Q4', audienceKind: 'DEPARTMENT', audienceIds: ['d-sales'] } }]);
    render(<PermissionContext.Provider value={{ permissions: new Set(['PEOPLE::Announcements::VIEW']), isAdmin: false }}><WorkspaceList kind="announcements" /></PermissionContext.Provider>);
    await waitFor(() => expect(screen.getAllByText('Sales').length).toBeGreaterThan(0));
  });
});

describe('Home: the "Your company has grown" card on a phone', () => {
  it('keeps its words a readable width, so the buttons wrap below instead of squeezing them', async () => {
    render(<PermissionContext.Provider value={{ permissions: new Set(), isAdmin: true }}><HomeSetup openScreen={() => {}} /></PermissionContext.Provider>);
    const heading = await screen.findByRole('heading', { name: 'Your company has grown' });
    expect(heading.parentElement.className).toMatch(/\bbasis-64\b/);
  });
});
