import { useEffect, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => true }) }));

const createCompany = vi.fn();
vi.mock('../../api/auth', () => ({ createCompany: (...a) => createCompany(...a) }));

const notify = { success: vi.fn(), error: vi.fn() };
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: (...a) => notify.success(...a), error: (...a) => notify.error(...a) } }));

import CompanyGroups from './CompanyGroups';

/**
 * Adding a company.
 *
 * The form for it existed and the button to open it did not: `setEditing` was
 * only ever called with an id, so the create branch was unreachable and the
 * only company an account could ever have was the one signup made.
 *
 * The create itself has to go through the server. An org owns the branches,
 * the warehouses and every document raised under it, so a company written only
 * to the browser store carries no `backendCompanyId` — and every server call
 * made under it falls back to `activeOrgId` and reads and writes the FIRST
 * company's data while showing its own name at the top of the screen.
 */

const seed = () => ({
  activeCompanyId: 1,
  companies: [{ id: 1, name: 'Neev', state: 'Haryana', gstin: '', currency: 'INR', parentCompanyId: null }],
  invoices: [], customers: [], items: [], bills: [],
});

// The store, held outside React so a test can read what was actually written.
const store = { db: null };
const Host = ({ initialAction = null }) => {
  const [db, setDb] = useState(seed);
  useEffect(() => {
    store.db = db;
  }, [db]);
  return <CompanyGroups db={db} setDb={setDb} currentCompany={db.companies[0]} initialAction={initialAction} />;
};

const fillForm = async (user, { name = 'Neev South', state = 'Karnataka' } = {}) => {
  await user.clear(screen.getByLabelText('Name'));
  await user.type(screen.getByLabelText('Name'), name);
  if (state) await user.selectOptions(screen.getByLabelText('State'), state);
};

beforeEach(() => {
  createCompany.mockReset();
  notify.success.mockReset();
  notify.error.mockReset();
  store.db = null;
});

describe('Add company', () => {
  it('offers a control to add one at all', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: /add company/i }));
    expect(screen.getByText('New company')).toBeInTheDocument();
  });

  it('creates the server org and stores the id the server gave back', async () => {
    createCompany.mockResolvedValue({ company: { id: 'org_2', name: 'Neev South', orgId: 'org_2' }, branch: { id: 'br_2' } });
    const user = userEvent.setup();
    render(<Host />);

    await user.click(screen.getByRole('button', { name: /add company/i }));
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /^add company$/i, hidden: false }));

    await waitFor(() => expect(createCompany).toHaveBeenCalledTimes(1));
    expect(createCompany).toHaveBeenCalledWith({ companyName: 'Neev South', state: 'Karnataka', gstin: null });

    await waitFor(() => expect(store.db.companies).toHaveLength(2));
    const added = store.db.companies[1];
    expect(added.name).toBe('Neev South');
    expect(added.profile.backendCompanyId).toBe('org_2');
    expect(added.profile.backendBranchId).toBe('br_2');
  });

  /*
   * The whole point of going through the server. A local-only company looks
   * added and then quietly operates on another company's books.
   */
  it('adds nothing locally when the server refuses', async () => {
    createCompany.mockRejectedValue(new Error('GSTIN does not match the state chosen'));
    const user = userEvent.setup();
    render(<Host />);

    await user.click(screen.getByRole('button', { name: /add company/i }));
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /^add company$/i }));

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('GSTIN does not match the state chosen'));
    expect(store.db.companies).toHaveLength(1);
  });

  /*
   * The state decides whether a sale splits into CGST + SGST or leaves as
   * IGST. The server rejects a create without one, so asking here saves a
   * round trip and says why.
   */
  it('will not submit without a state, and does not call the server', async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.click(screen.getByRole('button', { name: /add company/i }));
    await fillForm(user, { state: '' });
    await user.click(screen.getByRole('button', { name: /^add company$/i }));

    expect(createCompany).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalled();
    expect(store.db.companies).toHaveLength(1);
  });

  /* Arriving from "Add company" elsewhere lands on the form, not the list. */
  it('opens straight into the form when sent here to create', () => {
    render(<Host initialAction="create" />);
    expect(screen.getByText('New company')).toBeInTheDocument();
  });
});
