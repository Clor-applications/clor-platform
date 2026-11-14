import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * Compliance in depth (People audit 30 Oct 2026, gaps 10, 16, 21): one
 * Compliance screen with owner, proof and checked on each obligation, the
 * work sites' registrations, and the rules; the People report from the
 * headcount API.
 */
const api = vi.hoisted(() => ({
  listObligations: vi.fn(),
  addObligation: vi.fn(() => Promise.resolve({ id: 'o9' })),
  updateObligation: vi.fn(() => Promise.resolve({})),
  addProof: vi.fn(() => Promise.resolve({ id: 'p1', name: 'challan.pdf' })),
  openProof: vi.fn(),
  removeProof: vi.fn(() => Promise.resolve()),
  listOwners: vi.fn(() => Promise.resolve({ users: [{ id: 'u1', name: 'Suresh Owner' }], names: ['Mehta & Co (CA)'] })),
  listRegistrations: vi.fn(() => Promise.resolve({ types: [], sites: [{ id: 's1', name: 'Bengaluru office', state: 'Karnataka', registrations: [{ type: 'PF', number: 'KNBNG0045678000', validTill: null, label: 'PF code (EPFO)' }] }] })),
  listRules: vi.fn(() => Promise.resolve([])),
  saveRule: vi.fn(() => Promise.resolve({})),
  checkRule: vi.fn(() => Promise.resolve({})),
}));
const perms = vi.hoisted(() => ({ current: { isAdmin: true, permissions: new Set() } }));
const http = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../apps/people/src/api/compliance', () => api);
vi.mock('@platform/http', () => http);
vi.mock('@platform/context', () => ({ orgId: () => 'org1' }));
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
vi.mock('../packages/ui/src/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));

import { notify } from '@ui/components/ui/notify';
import Compliance from '../apps/people/src/screens/Compliance';
import PeopleReports from '../apps/people/src/screens/PeopleReports';

const ob = (over) => ({ id: 'o1', source: 'OWN', title: 'Fire licence renewal', establishment: null, period: 'own-1', dueOn: '2026-11-20', status: 'DUE', owner: 'HR', ownerSet: false, proofs: [], requiredProof: [], legalSource: 'Your own deadline', ruleChecked: true, ruleId: 'OWN', ruleVersion: 0, reference: null, note: null, ...over });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  perms.current = { isAdmin: true, permissions: new Set() };
});

describe('Compliance', () => {
  it('lists what is owed with owner and status, and counts each tab', async () => {
    api.listObligations.mockResolvedValue([ob(), ob({ id: 'o2', title: 'PF: ECR for Sep 2026', source: 'STATUTORY', status: 'DONE', owner: 'Our CA', ownerSet: true })]);
    render(<Compliance params={{}} updateParams={vi.fn()} />);
    expect((await screen.findAllByText('Fire licence renewal')).length).toBeGreaterThan(0);
    expect(screen.queryByText('PF: ECR for Sep 2026')).toBeNull();
    expect(screen.getByRole('tab', { name: /^Done\s*1$/ })).toBeTruthy();
  });

  it('marks an obligation done with a user as owner and a reference', async () => {
    api.listObligations.mockResolvedValue([ob()]);
    const user = userEvent.setup();
    render(<Compliance params={{ id: 'o1' }} updateParams={vi.fn()} />);
    const drawer = await screen.findByRole('dialog');
    await user.type(within(drawer).getByLabelText('Owner'), 'Suresh Owner');
    await user.type(within(drawer).getByLabelText('Reference'), 'FIRE/118');
    await user.click(within(drawer).getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(api.updateObligation).toHaveBeenCalledWith('o1', { ownerUserId: 'u1', ownerName: null, reference: 'FIRE/118', status: 'DONE' }));
  });

  it('a done obligation is checked next, and shows who did it', async () => {
    api.listObligations.mockResolvedValue([ob({ status: 'DONE', doneOn: '2026-10-30', doneBy: 'Kavya HR' })]);
    const user = userEvent.setup();
    render(<Compliance params={{ id: 'o1' }} updateParams={vi.fn()} />);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(/Done by Kavya HR/)).toBeTruthy();
    await user.click(within(drawer).getByRole('button', { name: 'Mark checked' }));
    await waitFor(() => expect(api.updateObligation).toHaveBeenCalledWith('o1', { status: 'CHECKED' }));
  });

  it('is read only without the right to act', async () => {
    perms.current = { isAdmin: false, permissions: new Set(['PEOPLE::Employees::VIEW']) };
    api.listObligations.mockResolvedValue([ob()]);
    render(<Compliance params={{ id: 'o1' }} updateParams={vi.fn()} />);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).queryByRole('button', { name: 'Mark done' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add a deadline/ })).toBeNull();
  });

  /*
   * The app's content security policy is enforced since 13 Nov 2026 and its
   * frame-src allows 'self' and blob: only, so the proof's own data: address
   * opened a blank window. It is handed to the browser as a blob instead.
   */
  it('opens a proof as a blob of its own kind, never a data: address', async () => {
    const pdf = 'data:application/pdf;base64,JVBERi0xLjQK';
    api.listObligations.mockResolvedValue([ob({ proofs: [{ id: 'p1', name: 'Renewal receipt.pdf', mime: 'application/pdf', by: 'HR' }] })]);
    api.openProof.mockResolvedValue({ name: 'Renewal receipt.pdf', mime: 'application/pdf', dataUrl: pdf });
    const opened = [];
    const open = vi.spyOn(window, 'open').mockImplementation((u) => {
      opened.push(String(u));
      return { opener: null, document: {}, close() {} };
    });
    const made = [];
    /* jsdom has no blob addresses of its own. */
    URL.createObjectURL = URL.createObjectURL || (() => '');
    URL.revokeObjectURL = URL.revokeObjectURL || (() => {});
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      made.push(b.type);
      return 'blob:http://localhost/proof-1';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    render(<Compliance params={{ id: 'o1' }} updateParams={vi.fn()} />);
    const drawer = await screen.findByRole('dialog');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Renewal receipt.pdf' }));
    await waitFor(() => expect(opened.length).toBe(1));
    expect(opened[0]).toMatch(/^blob:/);
    expect(made).toEqual(['application/pdf']);
    expect(notify.error).not.toHaveBeenCalled();

    /* Anything but a PDF or a picture is downloaded, not shown. */
    api.openProof.mockResolvedValue({ name: 'notes.html', mime: 'text/html', dataUrl: 'data:text/html;base64,PHA+aGk8L3A+' });
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Renewal receipt.pdf' }));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('That file cannot be shown here. Download it to open.'));
    expect(opened.length).toBe(1);
    open.mockRestore();
    create.mockRestore();
  });

  it('shows each work site’s registrations', async () => {
    api.listObligations.mockResolvedValue([]);
    render(<Compliance params={{ view: 'registrations' }} updateParams={vi.fn()} />);
    expect((await screen.findAllByText('KNBNG0045678000')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('No end date').length).toBeGreaterThan(0);
  });
});

describe('People report', () => {
  it('shows headcount, joiners, leavers and attrition by month from the headcount API', async () => {
    http.apiFetch.mockResolvedValue({ headcount: 10, months: [{ month: '2026-08', headcountAtStart: 9, joiners: 1, leavers: 1, headcountAtEnd: 10, attritionPct: 10.5, leaversByReason: { RESIGNED: 1 } }], totals: { joiners: 1, leavers: 1, headcountAtStart: 9, headcountAtEnd: 10, averageHeadcount: 9.5, attritionPct: 10.5 } });
    render(<PeopleReports params={{}} updateParams={vi.fn()} />);
    expect(await screen.findByText('Aug 2026')).toBeTruthy();
    expect(http.apiFetch.mock.calls[0][0]).toMatch(/\/people\/headcount\?from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}$/);
    expect(screen.getAllByText('10.5%').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('list', { name: 'Leavers by reason' })).getByText('Resigned')).toBeTruthy();
  });
});
