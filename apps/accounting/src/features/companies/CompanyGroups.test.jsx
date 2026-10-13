import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => true }) }));
import CompanyGroups from './CompanyGroups';

const seed = {
  activeCompanyId: 1,
  companies: [
    { id: 1, name: 'Neev', state: 'Haryana', gstin: '', currency: 'INR', parentCompanyId: null },
    { id: 2, name: 'Neev South', state: 'Karnataka', gstin: '', currency: 'INR', parentCompanyId: null },
  ],
  invoices: [], customers: [], items: [], bills: [],
};

const Host = () => {
  const [db, setDb] = useState(seed);
  return <CompanyGroups db={db} setDb={setDb} currentCompany={db.companies[0]} />;
};

describe('Company Profile', () => {
  /*
   * Branches and warehouses both open the record that was saved. A company
   * dropped you back on the list with a toast, so the only way to see what had
   * actually been stored was to find the row again and press the pencil.
   */
  it('opens a record when View is pressed', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getAllByRole('button', { name: 'View' })[0]);
    const panel = await screen.findByLabelText('Company details');
    expect(panel).toBeInTheDocument();
    expect(panel.textContent).toContain('Haryana');
  });

  it('shows the fields a company is defined by, not just its name', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getAllByRole('button', { name: 'View' })[0]);
    const panel = await screen.findByLabelText('Company details');
    const labels = [...panel.querySelectorAll('dt')].map((d) => d.textContent.trim());
    expect(labels).toEqual(
      expect.arrayContaining(['Name', 'State', 'GSTIN', 'Currency', 'Parent', 'Billed', 'Outstanding'])
    );
  });

  it('lands on the record it just saved, rather than back on the list', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getAllByRole('button', { name: /^Edit / })[0]);
    const name = await screen.findByDisplayValue('Neev');
    await user.clear(name);
    await user.type(name, 'Neev Renamed');
    await user.click(screen.getByRole('button', { name: /save|update/i }));
    await waitFor(async () => {
      const panel = await screen.findByLabelText('Company details');
      expect(panel.textContent).toContain('Neev Renamed');
    });
  });

  it('closes back to the list', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getAllByRole('button', { name: 'View' })[0]);
    await screen.findByLabelText('Company details');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByLabelText('Company details')).toBeNull());
  });
});

/*
 * The group page, on the shared list layout.
 *
 * It was a title, one button and a stack of rows: nothing said what the group
 * as a whole had billed or was owed, and with more than a handful of companies
 * there was no way to find one but to read the list.
 */
const groupSeed = {
  activeCompanyId: 1,
  companies: [
    { id: 1, name: 'Neev Steels', state: 'Karnataka', gstin: '29ABCDE1234F1Z5', parentCompanyId: null },
    { id: 2, name: 'Neev Fabrication', state: 'Karnataka', gstin: '29ZZZZZ1111Z1Z5', parentCompanyId: 1 },
    { id: 3, name: 'Coastal Traders', state: 'Kerala', gstin: '', parentCompanyId: null },
  ],
  invoices: [
    { id: 1, companyId: 1, total: 100000, paidAmount: 40000, status: 'Unpaid' },
    { id: 2, companyId: 2, total: 50000, paidAmount: 50000, status: 'Paid' },
    { id: 3, companyId: 3, total: 25000, paidAmount: 0, status: 'Draft' },
  ],
  customers: [], items: [], bills: [],
};

const GroupHost = () => {
  const [db, setDb] = useState(groupSeed);
  return <CompanyGroups db={db} setDb={setDb} currentCompany={db.companies[0]} />;
};

describe('the group at a glance', () => {
  it('carries five figures across the top', () => {
    render(<GroupHost />);
    expect(screen.getByRole('region', { name: /Summary/i }).children).toHaveLength(5);
  });

  it('adds the group up, leaving drafts out', () => {
    // 100,000 + 50,000 billed. The draft is an intention, not a receivable —
    // counting it would say the group billed 175,000.
    render(<GroupHost />);
    const summary = screen.getByRole('region', { name: /Summary/i });
    const billed = [...summary.children].find((c) => c.textContent.includes('Billed by the group'));
    expect(billed.textContent).toMatch(/1,50,000/);
    const owed = [...summary.children].find((c) => c.textContent.includes('Owed to the group'));
    expect(owed.textContent).toMatch(/60,000/);
  });

  it('counts how many companies can actually raise a tax invoice', () => {
    render(<GroupHost />);
    const summary = screen.getByRole('region', { name: /Summary/i });
    expect([...summary.children].find((c) => c.textContent.includes('GST registered')).textContent).toMatch(/2/);
    expect([...summary.children].find((c) => c.textContent.includes('Not registered')).textContent).toMatch(/1/);
  });

  it('says what a missing GSTIN costs, on the row', () => {
    // The old line only mentioned it when the state was missing too, so a
    // company with a state and no GSTIN read as complete.
    render(<GroupHost />);
    const row = screen.getByText('Coastal Traders').closest('.ui-card');
    expect(row.textContent).toMatch(/cannot raise a tax invoice/i);
  });

  it('finds a company by name, GSTIN or state', async () => {
    const user = userEvent.setup();
    render(<GroupHost />);
    await user.type(screen.getByLabelText(/Search companies/i), 'kerala');
    await waitFor(() => expect(screen.queryByText('Coastal Traders')).toBeInTheDocument());
    expect(screen.queryByText('Neev Fabrication')).toBeNull();
  });

  it('keeps a parent whose subsidiary matches, so the child is not left floating', async () => {
    const user = userEvent.setup();
    render(<GroupHost />);
    await user.type(screen.getByLabelText(/Search companies/i), 'Fabrication');
    await waitFor(() => expect(screen.queryByText('Neev Fabrication')).toBeInTheDocument());
    expect(screen.queryByText('Neev Steels')).toBeInTheDocument();
    expect(screen.queryByText('Coastal Traders')).toBeNull();
  });
});
