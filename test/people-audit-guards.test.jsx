import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * Guards from the 28 Oct 2026 audit: a register offers only what the
 * viewer's grant lets them do, and a form submitted twice by Enter saves once.
 */
const ws = vi.hoisted(() => ({ listRecords: vi.fn(), saveRecord: vi.fn(), deleteRecord: vi.fn() }));
const pol = vi.hoisted(() => ({ listPolicies: vi.fn(), policyConflicts: vi.fn(), createPolicy: vi.fn() }));
vi.mock('../apps/people/src/api/workspace', async (orig) => ({ ...(await orig()), ...ws }));
vi.mock('../apps/people/src/api/policies', async (orig) => ({ ...(await orig()), ...pol }));
vi.mock('@ui/personnel/api', async (orig) => ({ ...(await orig()), listAllEmployees: vi.fn(async () => ({ employees: [] })) }));
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import WorkspaceList from '../apps/people/src/screens/WorkspaceList';
import Policies from '../apps/people/src/screens/Policies';
import { PermissionContext } from '../packages/ui/src/permissions/context';

const withPerms = (keys, ui) => <PermissionContext.Provider value={{ permissions: new Set(keys), isAdmin: false }}>{ui}</PermissionContext.Provider>;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('A register shows only what the grant allows', () => {
  /* Hiring moved to its own screens (test/people-talent.test.jsx); the register still keeps assets. */
  const rows = [{ id: 'a1', title: 'Laptop 12', status: 'ASSIGNED', employeeId: null, details: { assetTag: 'LT-12' } }];
  ws.listRecords.mockImplementation(async () => rows);

  it('a viewer gets no New, no Edit or Delete', async () => {
    render(withPerms(['PEOPLE::Assets::VIEW'], <WorkspaceList kind="assets" />));
    expect(await screen.findAllByText('Laptop 12')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: /New asset/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
  });

  it('with the grants, New and each row action are there', async () => {
    const user = userEvent.setup();
    render(withPerms(['PEOPLE::Assets::VIEW', 'PEOPLE::Assets::CREATE', 'PEOPLE::Assets::EDIT', 'PEOPLE::Assets::DELETE'], <WorkspaceList kind="assets" />));
    expect(await screen.findByRole('button', { name: /New asset/ })).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /Actions for/ })[0]);
    for (const name of ['Edit', 'Delete']) expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
  });
});

describe('A policy saved by Enter twice is saved once', () => {
  it('ignores the second submit while the first is on its way', async () => {
    pol.listPolicies.mockResolvedValue({ policies: [], categories: [{ key: 'OTHER', label: 'Other' }], purposes: [], languages: [] });
    pol.policyConflicts.mockResolvedValue([]);
    let finish;
    pol.createPolicy.mockImplementation(() => new Promise((r) => { finish = r; }));
    const user = userEvent.setup();
    render(withPerms(['PEOPLE::Policies::VIEW', 'PEOPLE::Policies::CREATE'], <Policies />));
    await user.click(await screen.findByRole('button', { name: /New policy/ }));
    const title = screen.getByLabelText('Title *');
    await user.type(title, 'Travel');
    fireEvent.submit(title.closest('form'));
    fireEvent.submit(title.closest('form'));
    expect(pol.createPolicy).toHaveBeenCalledTimes(1);
    finish({ policy: { id: 'p1', title: 'Travel' } });
    await waitFor(() => expect(screen.queryByLabelText('Title *')).not.toBeInTheDocument());
  });
});
