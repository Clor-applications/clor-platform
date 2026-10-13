import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createPortal } from 'react-dom';

vi.mock('@ui/api/masters', async (importOriginal) => ({
  ...(await importOriginal()),
  lookupGstin: vi.fn(async () => ({ pan: 'AABCU9603R', source: 'derived' })),
}));

import { ChartAccountForm, expenseTdsBase } from '../../App';

/**
 * The ledger master: one form whose shape follows the group.
 *
 * It used to be a single flat list — name, group, opening balance, a GST rate
 * and four bank fields, all on screen at once whatever kind of ledger was being
 * made. The spec asks for Basic Details above tabs that the group decides, so
 * an Indirect Expenses ledger is not offered somewhere to type an IFSC and a
 * bank ledger is not asked for a TDS section.
 */

const group = (id, name, typeId, groupCategory = '') => ({ id, companyId: 1, name, typeId, groupCategory, parentGroupId: null });

const db = {
  chartOfAccounts: [],
  accountTypes: [{ id: 1, companyId: 1, name: 'Bank', accountClass: 'Asset', main: 'Balance Sheet' }],
  accountGroups: [
    group(10, 'Bank Accounts', 1),
    group(11, 'Indirect Expenses', 1, 'Expense'),
    group(12, 'Duties & Taxes', 1),
    group(13, 'TDS Payable', 1),
    group(14, 'TCS Payable', 1),
  ],
};
const company = { id: 1, name: 'Test Co', state: 'Karnataka' };

const renderForm = (props = {}) =>
  render(<ChartAccountForm db={db} setDb={() => {}} currentCompany={company} onClose={() => {}} {...props} />);

const groupTrigger = () => screen.getByLabelText('Ledger Group *');

const pickGroup = async (user, name) => {
  await user.click(groupTrigger());
  await user.click((await screen.findAllByRole('option')).find((o) => o.textContent.includes(name)));
};

beforeEach(() => vi.clearAllMocks());

describe('Basic Details', () => {
  it('holds only what the spec allows above the tabs', () => {
    renderForm();
    /* The spec marks the three mandatory fields with an asterisk. */
    expect(screen.getByLabelText(/^Ledger Name \*$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Currency \*$/)).toBeInTheDocument();
    expect(screen.getByLabelText('Opening Balance')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Dr \(Default\)/ })).toBeChecked();
    // Excluded by the spec.
    expect(screen.queryByLabelText(/^Description$/i)).toBeNull();
  });
});

describe('the group decides the tabs', () => {
  it('offers Bank Details for a bank ledger and no TDS tab', async () => {
    const user = userEvent.setup();
    renderForm();
    await pickGroup(user, 'Bank Accounts');

    expect(screen.getByRole('tab', { name: 'Bank Details' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'TDS Details' })).toBeNull();
  });

  it('offers TDS Mapping under a TDS group and no bank tab', async () => {
    const user = userEvent.setup();
    renderForm();
    await pickGroup(user, 'TDS Payable');

    expect(screen.getByRole('tab', { name: 'TDS Mapping' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Bank Details' })).toBeNull();
  });

  /* Statutory, Address and Contacts apply to any ledger. */
  it('always offers Statutory, Address and Contact Persons', async () => {
    const user = userEvent.setup();
    renderForm();
    await pickGroup(user, 'Indirect Expenses');

    for (const name of ['Statutory Details', 'Address', 'Contact Persons']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('tab', { name: 'Bank Details' })).toBeNull();
  });
});

describe('Bank Details', () => {
  it('carries the fields the approved example shows', async () => {
    const user = userEvent.setup();
    renderForm();
    await pickGroup(user, 'Bank Accounts');
    await user.click(screen.getByRole('tab', { name: 'Bank Details' }));

    for (const label of ['Bank Name *', 'Account Number *', 'IFSC Code *', 'Branch Name', 'Account Holder Name', 'UPI ID', 'Branch Address', 'Account Type']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  /*
   * The spec is explicit: PAN and GSTIN belong to Statutory Details and must
   * not appear inside Bank Details.
   */
  it('keeps PAN and GSTIN out of the bank tab', async () => {
    const user = userEvent.setup();
    renderForm();
    await pickGroup(user, 'Bank Accounts');
    await user.click(screen.getByRole('tab', { name: 'Bank Details' }));

    expect(screen.queryByLabelText('PAN')).toBeNull();
    expect(screen.queryByLabelText('GSTIN')).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Statutory Details' }));
    expect(screen.getByLabelText('PAN')).toBeInTheDocument();
    expect(screen.getByLabelText('GSTIN')).toBeInTheDocument();
  });
});

describe('TDS Details', () => {
  /*
   * The ledger is the accounting destination, not the calculator — and what it
   * accumulates is a NATURE, not a section number. The section, the rate and
   * the threshold are then whatever the rule in force on a transaction's date
   * says they are. Asking for a section here froze one year's answer into the
   * ledger master, and asking for a rate put a second copy of it in the
   * product.
   */
  it('asks for a nature — never a section, rate or threshold', async () => {
    const user = userEvent.setup();
    renderForm();
    await pickGroup(user, 'TDS Payable');
    await user.click(screen.getByRole('tab', { name: 'TDS Mapping' }));

    expect(screen.getByLabelText('TDS Nature')).toBeInTheDocument();
    expect(screen.queryByLabelText('TDS Section')).toBeNull();
    expect(screen.queryByLabelText('Rate (%)')).toBeNull();
    expect(screen.queryByLabelText(/threshold/i)).toBeNull();
  });

  it('shows the rule, reference and default rate read-only, and an Active switch', async () => {
    const user = userEvent.setup();
    renderForm();
    await pickGroup(user, 'TDS Payable');
    await user.click(screen.getByRole('tab', { name: 'TDS Mapping' }));

    await user.selectOptions(screen.getByLabelText('TDS Nature'), 'PROFESSIONAL_SERVICES');
    /* The Rule Master's answer, stated, not typed. */
    expect(screen.getByText('TDS Rule')).toBeInTheDocument();
    expect(screen.getByText(/PROFESSIONAL_SERVICES@V/)).toBeInTheDocument();
    expect(screen.getByText('Default Rate')).toBeInTheDocument();
    expect(screen.getByText(/^10%$/)).toBeInTheDocument();
    expect(screen.getByText(/the engine does the calculation/i)).toBeInTheDocument();
    /* Availability on transactions, on by default. */
    expect(screen.getByLabelText(/Available on transactions/)).toBeChecked();
  });
});

describe('the group decides which side the opening balance opens on', () => {
  /*
   * A liability ledger opened on the debit side is a wrong sign that nothing
   * complains about — the number looks right until the trial balance is read.
   */
  const natureDb = {
    chartOfAccounts: [],
    accountTypes: [
      { id: 1, companyId: 1, name: 'Bank', accountClass: 'Asset', main: 'Balance Sheet' },
      { id: 2, companyId: 1, name: 'Current Liabilities', accountClass: 'Liability', main: 'Balance Sheet' },
    ],
    accountGroups: [group(10, 'Bank Accounts', 1), group(20, 'Sundry Creditors', 2)],
  };

  it('credits a liability group and debits an asset group', async () => {
    const user = userEvent.setup();
    render(<ChartAccountForm db={natureDb} setDb={() => {}} currentCompany={company} onClose={() => {}} />);

    await pickGroup(user, 'Sundry Creditors');
    expect(screen.getByRole('radio', { name: 'Cr' })).toBeChecked();

    await pickGroup(user, 'Bank Accounts');
    expect(screen.getByRole('radio', { name: /Dr \(Default\)/ })).toBeChecked();
  });

  it('leaves a chosen side alone when the group changes afterwards', async () => {
    const user = userEvent.setup();
    render(<ChartAccountForm db={natureDb} setDb={() => {}} currentCompany={company} onClose={() => {}} />);

    await pickGroup(user, 'Bank Accounts');
    // A bank overdraft is a real credit balance on an asset group.
    await user.click(screen.getByRole('radio', { name: 'Cr' }));
    await pickGroup(user, 'Sundry Creditors');
    await pickGroup(user, 'Bank Accounts');

    expect(screen.getByRole('radio', { name: 'Cr' })).toBeChecked();
  });
});

describe('what the form refuses', () => {
  const fill = async (user, label, value) => {
    const field = screen.getByLabelText(label);
    await user.clear(field);
    await user.type(field, value);
  };

  it('will not save a bank ledger without a valid IFSC', async () => {
    const user = userEvent.setup();
    const setDb = vi.fn();
    render(<ChartAccountForm db={db} setDb={setDb} currentCompany={company} onClose={() => {}} />);

    await fill(user, /^Ledger Name \*$/, 'HDFC Bank - Current Account');
    await pickGroup(user, 'Bank Accounts');
    await user.click(screen.getByRole('tab', { name: 'Bank Details' }));
    await fill(user, 'Bank Name *', 'HDFC Bank Limited');
    await fill(user, 'Account Number *', '50100012345678');
    await fill(user, 'IFSC Code *', 'HDFCX001234');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(setDb).not.toHaveBeenCalled();

    await fill(user, 'IFSC Code *', 'HDFC0001234');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(setDb).toHaveBeenCalled();
  });

  it('will not save a second ledger under a name already used', async () => {
    const user = userEvent.setup();
    const setDb = vi.fn();
    const taken = { ...db, chartOfAccounts: [{ id: 5, companyId: 1, name: 'Office Rent' }] };
    render(<ChartAccountForm db={taken} setDb={setDb} currentCompany={company} onClose={() => {}} />);

    await fill(user, /^Ledger Name \*$/, 'office   rent');
    await pickGroup(user, 'Indirect Expenses');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(setDb).not.toHaveBeenCalled();
  });
});

describe('Save and New', () => {
  it('saves, keeps the group and clears the ledger for the next one', async () => {
    const user = userEvent.setup();
    const setDb = vi.fn();
    render(<ChartAccountForm db={db} setDb={setDb} currentCompany={company} onClose={() => {}} />);

    const name = screen.getByLabelText(/^Ledger Name \*$/);
    await user.type(name, 'Office Rent');
    await pickGroup(user, 'Indirect Expenses');
    await user.click(screen.getByRole('button', { name: 'Save and New' }));

    expect(setDb).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/^Ledger Name \*$/)).toHaveValue('');
    // The next ledger is almost always a sibling of the one just saved.
    expect(screen.getByRole('tab', { name: 'Statutory Details' })).toBeInTheDocument();
  });

  it('is not offered while editing an existing ledger', () => {
    render(
      <ChartAccountForm
        db={db}
        setDb={() => {}}
        currentCompany={company}
        onClose={() => {}}
        initialData={{ id: 5, companyId: 1, name: 'Office Rent', groupId: 11 }}
      />
    );
    expect(screen.queryByRole('button', { name: 'Save and New' })).toBeNull();
  });
});

describe('a ledger that has been posted to', () => {
  /*
   * Re-filing it moves every figure it holds onto another statement, and the
   * entries that produced them say nothing about the move.
   */
  const posted = {
    ...db,
    chartOfAccounts: [{ id: 5, companyId: 1, name: 'Office Rent', groupId: 11 }],
    journalEntries: [{ companyId: 1, lines: [{ accountId: '5' }] }],
  };

  it('keeps its group', () => {
    render(
      <ChartAccountForm db={posted} setDb={() => {}} currentCompany={company} onClose={() => {}} initialData={posted.chartOfAccounts[0]} />
    );
    expect(groupTrigger()).toBeDisabled();
    expect(screen.getByText(/its group is fixed/i)).toBeInTheDocument();
  });

  it('lets an untouched ledger be re-filed', () => {
    render(
      <ChartAccountForm db={{ ...posted, journalEntries: [] }} setDb={() => {}} currentCompany={company} onClose={() => {}} initialData={posted.chartOfAccounts[0]} />
    );
    expect(groupTrigger()).not.toBeDisabled();
  });
});

describe('the TDS Mapping shows the rule it points at', () => {
  it('reads threshold and the statutory reference from the rule', async () => {
    const user = userEvent.setup();
    renderForm();
    await pickGroup(user, 'TDS Payable');
    await user.click(screen.getByRole('tab', { name: 'TDS Mapping' }));
    await user.selectOptions(screen.getByLabelText('TDS Nature'), 'CONTRACTOR_SUB_CONTRACTOR');

    expect(screen.getByText(/30,000 per payment/)).toBeInTheDocument();
    /* The reference the rule in force gives — 393 from April 2026. */
    expect(screen.getByText(/393\(1\)/)).toBeInTheDocument();
    /* Which side, read from the group rather than asked for twice. */
    expect(screen.getByText('Payable')).toBeInTheDocument();
  });
});

describe('the group list is the chart, in tree order', () => {
  /*
   * "TDS Payable" means one thing under Duties & Taxes and another on its own,
   * so a child has to be shown where it sits. Alphabetical order puts it
   * nowhere near its parent.
   */
  const nested = {
    ...db,
    accountGroups: [
      { id: 12, companyId: 1, name: 'Duties & Taxes', typeId: 1, parentGroupId: null },
      { id: 13, companyId: 1, name: 'TDS Payable', typeId: 1, parentGroupId: 12 },
      { id: 14, companyId: 1, name: 'Bank Accounts', typeId: 1, parentGroupId: null },
      /* Enough groups that the picker offers its search box. */
      ...['Capital', 'Computers', 'Direct Expenses', 'Direct Income', 'Investments', 'Loans'].map((name, i) => ({
        id: 20 + i,
        companyId: 1,
        name,
        typeId: 1,
        parentGroupId: null,
      })),
    ],
  };

  it('indents a child and keeps it under its parent', async () => {
    const user = userEvent.setup();
    render(<ChartAccountForm db={nested} setDb={() => {}} currentCompany={company} onClose={() => {}} />);
    await user.click(groupTrigger());

    const labels = (await screen.findAllByRole('option')).map((o) => o.textContent);
    const parent = labels.findIndex((l) => l.includes('Duties & Taxes'));
    const child = labels.findIndex((l) => l.includes('TDS Payable'));

    expect(child).toBe(parent + 1);
    // Bank Accounts sorts before Duties & Taxes at the root, so a flat
    // alphabetical list would have put the child last.
    expect(labels[child]).not.toBe('TDS Payable');
    expect(labels[child].trim()).toBe('TDS Payable');
  });

  it('still finds a nested group by typing its plain name', async () => {
    const user = userEvent.setup();
    render(<ChartAccountForm db={nested} setDb={() => {}} currentCompany={company} onClose={() => {}} />);
    await user.click(groupTrigger());
    await user.type(screen.getByPlaceholderText(/search select group/i), 'TDS');

    const labels = (await screen.findAllByRole('option')).map((o) => o.textContent.trim());
    expect(labels).toContain('TDS Payable');
  });
});

describe('the two columns of Basic Details', () => {
  /*
   * The same arrangement the party masters carry: both halves on the grid's
   * own rows, so the group's name sits on the ledger name's line and its
   * control on the opening balance's, and every control is one width.
   */
  const rowOf = (el) => (el.className.match(/lg:row-start-(\d)/) || [])[1];

  it('puts the halves on the same rows', () => {
    renderForm({ fullPage: true });
    expect(rowOf(screen.getByLabelText(/^Ledger Name/).closest('div.grid'))).toBe('1');
    /* The label is beside its control now, so the row is the pair. */
    expect(rowOf(screen.getByText('Ledger Group').closest('div.grid'))).toBe('1');
    expect(rowOf(screen.getByLabelText('Opening Balance').closest('div.grid'))).toBe('2');
    expect(rowOf(screen.getByText('Currency').closest('div.grid'))).toBe('2');
  });

  it('gives every control the one width', () => {
    renderForm({ fullPage: true });
    expect(screen.getByLabelText(/^Ledger Name/).parentElement.className).toContain('max-w-[25rem]');
    expect(screen.getByLabelText('Ledger Group *').closest('div').className).toContain('max-w-[25rem]');
  });

  it('keeps the balance and its side together', () => {
    renderForm({ fullPage: true });
    /* Balance Type is under the balance it qualifies, not across the card. */
    expect(rowOf(screen.getByRole('radio', { name: /Dr \(Default\)/ }).closest('div.grid'))).toBe('3');
  });

  it('calls the lookup by the number it takes', () => {
    renderForm({ fullPage: true });
    /* GSTIN, not GSTN — the same wording as the party masters. */
    expect(screen.getByRole('button', { name: /Fetch from GSTIN/i })).toBeInTheDocument();
  });
});

describe('as a screen rather than a dialog', () => {
  /*
   * A ledger has five tabs behind it — bank, statutory, TDS, addresses, the
   * people who answer about it — and the dialog gave all of that a scrolling
   * box with the list greyed out behind it. As a screen it gets the same three
   * cards as the customer and vendor masters.
   */
  it('brings its own bar, with every way out of the screen on it', () => {
    renderForm({ fullPage: true });
    expect(screen.getByRole('heading', { name: 'New Ledger' })).toBeInTheDocument();
    for (const name of ['Back', 'Cancel', 'Save']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    /* The dialog's own footer would be a second set of the same buttons. */
    expect(screen.queryByRole('button', { name: 'Save and New' })).toBeNull();
  });

  it('says it is an edit when it is one', () => {
    renderForm({ fullPage: true, initialData: { id: 5, companyId: 1, name: 'HDFC Current', groupId: 10 } });
    expect(screen.getByRole('heading', { name: 'Edit Ledger' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('lays the identity out in cards, not one column of rows', () => {
    const { container } = renderForm({ fullPage: true });
    expect(container.querySelectorAll('.ui-card').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Enter the primary information about this ledger.')).toBeInTheDocument();
  });

  it('asks for the same things either way', async () => {
    const user = userEvent.setup();
    const { unmount } = renderForm({ fullPage: true });
    await pickGroup(user, 'Bank Accounts');
    /* The group still decides the tabs — the shell changed, not the form. */
    expect(screen.getByRole('tab', { name: 'Bank Details' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Ledger Name \*$/)).toBeInTheDocument();
    unmount();

    /* And the dialog is unchanged: it keeps its own footer. */
    renderForm();
    expect(screen.queryByRole('heading', { name: 'New Ledger' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save and New' })).toBeInTheDocument();
  });
});

describe('quick create inside a document', () => {
  it('saves the ledger without submitting the document underneath', async () => {
    const user = userEvent.setup();
    const parentSubmit = vi.fn((event) => event.preventDefault());
    const ledgerCreated = vi.fn();
    const setDb = vi.fn();

    const QuickCreateHost = () => (
      <form onSubmit={parentSubmit}>
        {createPortal(
          <ChartAccountForm
            db={db}
            setDb={setDb}
            currentCompany={company}
            onClose={() => {}}
            onCreated={ledgerCreated}
          />,
          document.body
        )}
      </form>
    );
    render(<QuickCreateHost />);

    await user.type(screen.getByLabelText(/^Ledger Name \*$/), 'Professional Fees');
    await pickGroup(user, 'Indirect Expenses');
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));

    expect(ledgerCreated).toHaveBeenCalledWith(expect.objectContaining({ name: 'Professional Fees' }));
    expect(setDb).toHaveBeenCalled();
    expect(parentSubmit).not.toHaveBeenCalled();
  });
});

describe('expense-ledger TDS applicability', () => {
  it('shows the option immediately when quick-create is restricted to expense groups', () => {
    renderForm({ includeGroupIds: [11] });
    expect(screen.getByLabelText('TDS Applicable')).toBeInTheDocument();
    expect(screen.getByLabelText('Ledger Group *')).toHaveTextContent('Indirect Expenses');
  });

  it('stores an explicit applicability choice on an expense ledger', async () => {
    const user = userEvent.setup();
    const ledgerCreated = vi.fn();
    renderForm({ onCreated: ledgerCreated });

    await user.type(screen.getByLabelText(/^Ledger Name \*$/), 'Professional Fees');
    await pickGroup(user, 'Indirect Expenses');
    await user.selectOptions(screen.getByLabelText('TDS Applicable'), 'yes');
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));

    expect(ledgerCreated).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Professional Fees',
      tdsApplicable: true,
    }));
  });

  it('builds the TDS base only from applicable expense ledgers', () => {
    const ledgers = [
      { id: 1, tdsApplicable: true },
      { id: 2, tdsApplicable: false },
    ];
    const lines = [
      { ledgerId: 1, amount: 250000 },
      { ledgerId: 2, amount: 100000 },
    ];
    expect(expenseTdsBase(lines, ledgers)).toBe(250000);
  });
});
