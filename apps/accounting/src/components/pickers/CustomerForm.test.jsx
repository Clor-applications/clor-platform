import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@ui/api/masters', async (importOriginal) => ({
  ...(await importOriginal()),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  listCustomers: vi.fn(async () => ({ customers: [] })),
  lookupGstin: vi.fn(),
}));
const notify = { success: vi.fn(), error: vi.fn() };
vi.mock('@ui/components/ui/notify', () => ({
  notify: { success: (...a) => notify.success(...a), error: (...a) => notify.error(...a) },
  confirmDialog: vi.fn(async () => true),
}));

import { lookupGstin, updateCustomer } from '@ui/api/masters';
import { CustomerForm } from './CustomerPicker';

/**
 * The customer master form.
 *
 * The old form had two fixed addresses and a single `contactPerson` string, so
 * a customer with a second warehouse and an accounts clerk had nowhere to put
 * either. These hold the parts of the spec that could not be expressed before.
 */

const db = { customers: [], chartOfAccounts: [], accountGroups: [{ id: 1, companyId: 1, name: 'Sundry Debtors' }], accountTypes: [] };
const company = { id: 1, name: 'Test Co', state: 'Karnataka' };

const renderForm = (props = {}) =>
  render(<CustomerForm db={db} setDb={() => {}} currentCompany={company} onClose={() => {}} {...props} />);

beforeEach(() => {
  notify.success.mockReset();
  notify.error.mockReset();
  lookupGstin.mockReset();
  updateCustomer.mockReset();
});

/*
 * Billing state is required, and rightly: it decides whether a sale splits into
 * CGST + SGST or leaves as IGST. Set through the picker the form actually uses.
 */
const setBillingState = async (user, name = 'Karnataka') => {
  const control = screen.getByLabelText('State, address 1');
  if (control.tagName === 'SELECT') {
    await user.selectOptions(control, name);
    return;
  }
  await user.click(control);
  await user.click((await screen.findAllByRole('option')).find((o) => o.textContent.includes(name)));
};

describe('basic details', () => {
  it('asks which branch carries a non-zero opening balance when multiple branches exist', async () => {
    const user = userEvent.setup();
    render(<CustomerForm
      db={{ ...db, branches: [{ id: 10, companyId: 1, name: 'Head Office' }, { id: 20, companyId: 1, name: 'South Branch' }] }}
      setDb={() => {}}
      currentCompany={company}
      onClose={() => {}}
    />);
    expect(screen.queryByLabelText('Opening Balance Branch')).toBeNull();
    await user.type(screen.getByLabelText('Opening Balance'), '500');
    const branch = screen.getByLabelText('Opening Balance Branch');
    expect(branch).toBeRequired();
    expect(Array.from(branch.options).map((option) => option.textContent)).toEqual(['Select branch', 'Head Office', 'South Branch']);
  });

  it('asks the six things every customer needs, in order', () => {
    renderForm();
    for (const label of ['GST', 'Customer Name', 'Customer Group', 'Currency']) {
      expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
    }
    expect(screen.getByPlaceholderText('0.00')).toBeInTheDocument();
    // Dr stays beside the compact amount and is the default.
    expect(screen.getByRole('radio', { name: 'Dr' })).toBeChecked();
  });

  /* GSTIN is only asked of somebody who says they have one. */
  it('shows the GSTIN field only when registered', async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.getByPlaceholderText('Enter 15 digit GSTIN')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Unregistered' }));
    expect(screen.queryByPlaceholderText('Enter 15 digit GSTIN')).toBeNull();
  });

  it('fills the state and PAN from the GSTIN when fetched', async () => {
    lookupGstin.mockResolvedValue({ pan: 'AABCU9603R', state: 'Karnataka', source: 'derived' });
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByPlaceholderText('Enter 15 digit GSTIN'), '29AABCU9603R1ZJ');
    await user.click(screen.getByRole('button', { name: /Fetch from GSTIN/i }));

    expect(lookupGstin).toHaveBeenCalledWith('29AABCU9603R1ZJ');
    await user.click(screen.getByRole('tab', { name: 'Statutory Details' }));
    expect(screen.getByLabelText('PAN')).toHaveValue('AABCU9603R');
  });

  it('keeps the allotted customer code when GSTIN details are fetched', async () => {
    lookupGstin.mockResolvedValue({
      code: '29AABCU9603R1ZJ',
      pan: 'AABCU9603R',
      state: 'Karnataka',
      source: 'portal',
    });
    const user = userEvent.setup();
    renderForm();

    expect(screen.getByLabelText('Customer Code')).toHaveValue('200000');
    await user.type(screen.getByPlaceholderText('Enter 15 digit GSTIN'), '29AABCU9603R1ZJ');
    await user.click(screen.getByRole('button', { name: /Fetch from GSTIN/i }));

    expect(screen.getByLabelText('Customer Code')).toHaveValue('200000');
  });

  it('refuses to fetch a number that is not 15 characters', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByPlaceholderText('Enter 15 digit GSTIN'), '29AAB');
    await user.click(screen.getByRole('button', { name: /Fetch from GSTIN/i }));
    expect(lookupGstin).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalled();
  });
});

describe('addresses', () => {
  it('opens on Billing and Shipping, and adds named places beyond them', async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.getByDisplayValue('Billing')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Shipping')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Address Line 1')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: /Add Address/i }));
    expect(screen.getAllByLabelText('Address Line 1')).toHaveLength(3);
    // Named for the user, not left blank for them to name.
    expect(screen.getByDisplayValue('Shipping 2')).toBeInTheDocument();
  });

  /*
   * Every document reaches for billing and shipping by name, so those two
   * cannot be renamed or removed. The ones the user adds can be.
   */
  it('will not let the two built-in places be removed or renamed', async () => {
    const user = userEvent.setup();
    renderForm();

    /* The two built-in rows keep their delete controls disabled and their
       location names cannot be edited. */
    expect(screen.getByRole('button', { name: /Delete Billing/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Delete Shipping$/i })).toBeDisabled();
    expect(screen.getByDisplayValue('Billing')).toHaveAttribute('readonly');

    await user.click(screen.getByRole('button', { name: /Add Address/i }));
    expect(screen.getByRole('button', { name: /Delete Shipping 2/i })).toBeEnabled();
  });

  it('enables city selection only after country and state are selected', async () => {
    const user = userEvent.setup();
    renderForm();

    const city = screen.getByLabelText('City, address 1');
    expect(city).toBeDisabled();

    await waitFor(() => expect(screen.getByLabelText('Country, address 1').options.length).toBeGreaterThan(1));
    const state = screen.getByLabelText('State, address 1');
    expect(state).toBeEnabled();
    await user.selectOptions(state, 'Karnataka');
    await waitFor(() => expect(screen.getByLabelText('City, address 1')).toBeEnabled());
    expect(screen.getByLabelText('City, address 1').options.length).toBeGreaterThan(1);
  });

  it('asks only for what an Indian address prints — district is not one of them', () => {
    renderForm();
    expect(screen.queryByLabelText('District')).toBeNull();
    expect(screen.getAllByLabelText('Pincode')).toHaveLength(2);
  });
});

describe('contacts', () => {
  /*
   * A line is already there. An empty state with an Add button is one click
   * before anybody can start, and the commonest customer has exactly one
   * contact.
   */
  it('opens with one line ready to type into', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('tab', { name: 'Contacts' }));

    expect(screen.getByLabelText('Contact name, row 1')).toBeInTheDocument();
    expect(screen.queryByText('No contacts yet.')).toBeNull();
  });

  it('takes more people when asked', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('tab', { name: 'Contacts' }));
    await user.click(screen.getByRole('button', { name: /Add Contact/i }));

    expect(screen.getByLabelText('Position, row 2')).toBeInTheDocument();
  });
});

describe('the remaining tabs', () => {
  it('puts the customer code in Basic Details and keeps credit and statutory fields in their tabs', async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.getByLabelText('Customer Code')).toHaveValue('200000');

    await user.click(screen.getByRole('tab', { name: 'Credit Details' }));
    expect(screen.getByLabelText(/Credit Period/)).toBeInTheDocument();
    expect(screen.getByLabelText('Credit Limit')).toBeInTheDocument();
    expect(screen.getByLabelText('Price List')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Statutory Details' }));
    expect(screen.getByLabelText('MSME / Udyam')).toBeInTheDocument();

  });

  /*
   * The spec listed GSTIN twice, under Basic Details and again under
   * Statutory. The same value in two editable fields on one form is how two
   * different values get saved, so the second one states it and does not take
   * input.
   */
  /*
   * The master asks for the GSTIN to be viewable and editable here as the
   * detailed statutory record, and warns against two independent values. Both
   * fields are bound to the one value in state, so it is one number seen twice.
   */
  it('shows the same GSTIN under Statutory, editable, and edits flow back', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByPlaceholderText('Enter 15 digit GSTIN'), '29AABCU9603R1ZJ');
    await user.click(screen.getByRole('tab', { name: 'Statutory Details' }));

    const shown = screen.getByLabelText('GSTIN');
    expect(shown).toHaveValue('29AABCU9603R1ZJ');
    expect(shown).not.toHaveAttribute('readonly');

    await user.clear(shown);
    await user.type(shown, '27AABCU9603R1ZK');

    // Back on Basic Details it is the same number, not a second one.
    await user.click(screen.getByRole('tab', { name: 'Address' }));
    expect(screen.getByPlaceholderText('Enter 15 digit GSTIN')).toHaveValue('27AABCU9603R1ZK');
  });
});

describe('the record reaches the server', () => {
  /*
   * The gap this closes: the Customers screen wrote the customer to the browser
   * and stopped. The server write only ever happened when a customer was
   * created from inside an invoice, and even there it sent six fields. So the
   * contacts, the extra addresses, the group, the MSME number and the rest
   * reached nothing — and the customer code the server allots, which the master
   * asks to be auto generated, was never asked for.
   */
  it('sends the whole master, and keeps the code the server allotted', async () => {
    const { createCustomer } = await import('@ui/api/masters');
    createCustomer.mockResolvedValue({ party: { id: 'srv_1', code: '200000' } });

    const rows = [];
    const user = userEvent.setup();
    render(
      <CustomerForm
        db={db}
        setDb={(next) => rows.push(typeof next === 'function' ? next({ customers: [] }) : next)}
        currentCompany={company}
        onClose={() => {}}
      />
    );

    await user.click(screen.getByRole('radio', { name: 'Unregistered' }));
    await user.type(screen.getByPlaceholderText('Enter customer name'), 'Acme Traders');
    await setBillingState(user);

    await user.click(screen.getByRole('tab', { name: 'Contacts' }));
    await user.click(screen.getByRole('button', { name: /Add Contact/i }));
    await user.type(screen.getByLabelText('Contact name, row 1'), 'Priya Nair');
    await user.type(screen.getByLabelText('Position, row 1'), 'Accounts');

    await user.click(screen.getByRole('tab', { name: 'Statutory Details' }));
    await user.type(screen.getByLabelText('MSME / Udyam'), 'UDYAM-KR-03-0001234');

    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    expect(createCustomer).toHaveBeenCalledTimes(1);
    const sent = createCustomer.mock.calls[0][0];
    expect(sent.name).toBe('Acme Traders');
    expect(sent.code).toBe('200000');
    expect(sent.msmeNumber).toBe('UDYAM-KR-03-0001234');
    expect(sent.contacts).toEqual([{ name: 'Priya Nair', position: 'Accounts', email: undefined, mobile: undefined, isPrimary: false }]);

    // The allotted code comes back onto the local row — this is the master's
    // "auto generated", which previously stayed blank.
    const written = rows.at(-1);
    expect(written.customers.at(-1).code).toBe('200000');
    expect(written.customers.at(-1).backendPartyId).toBe('srv_1');
  });

  /* A refused write must not lose the entry. */
  it('keeps the customer on this device when the server refuses', async () => {
    const { createCustomer } = await import('@ui/api/masters');
    createCustomer.mockRejectedValue(new Error('offline'));

    const rows = [];
    const user = userEvent.setup();
    render(<CustomerForm db={db} setDb={(n) => rows.push(n)} currentCompany={company} onClose={() => {}} />);

    await user.click(screen.getByRole('radio', { name: 'Unregistered' }));
    await user.type(screen.getByPlaceholderText('Enter customer name'), 'Offline Co');
    await setBillingState(user);
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    expect(rows.at(-1).customers.at(-1).name).toBe('Offline Co');
    expect(rows.at(-1).customers.at(-1).code).toBe('200000');
    expect(notify.error).toHaveBeenCalled();
  });
});

describe('header actions', () => {
  /*
   * A form with tabs has no single bottom — the page ends wherever the selected
   * tab ends — so a bottom bar moves as you switch between Address and Others.
   * The spec puts the actions at the top, where they sit in one place whichever
   * tab is open.
   */
  it('puts Save and Cancel at the top and leaves no bottom bar', () => {
    const { container } = renderForm();
    const save = screen.getByRole('button', { name: /^Save$/ });
    const cancel = screen.getByRole('button', { name: /^Cancel$/ });
    const tabs = screen.getByRole('tab', { name: 'Address' });

    // Both actions come before the tab strip in the document.
    expect(save.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cancel.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // And there is exactly one of each, so the old bar is gone rather than duplicated.
    expect(screen.getAllByRole('button', { name: /^Save$/ })).toHaveLength(1);
    expect(container.querySelectorAll('button[value="saveAndNew"]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Save and New/i })).toBeNull();
  });

  /*
   * The same header the invoice uses, not a second one that looks like it:
   * Back, Cancel, Save, and a three-dot menu for the rest.
   */
  it('uses the shared document header, with Back beside the way out', () => {
    renderForm();
    expect(screen.getByRole('button', { name: /^Back$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeInTheDocument();
  });

  it('keeps the secondary actions behind the three-dot menu', async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.queryByText(/Save and add another/i)).toBeNull();

    await user.click(screen.getByRole('button', { name: /More options/i }));
    expect(screen.getByText(/Save and add another/i)).toBeInTheDocument();
    expect(screen.getByText(/Clear the form/i)).toBeInTheDocument();
  });
});

describe('Others tab', () => {
  it('does not duplicate customer status in the Others tab', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('tab', { name: 'Others' }));

    expect(screen.queryByRole('combobox', { name: 'Customer Status' })).toBeNull();
  });
});

describe('customer status', () => {
  it('is hidden while creating and available above GST details while editing', async () => {
    const user = userEvent.setup();
    const { unmount } = renderForm();
    expect(screen.queryByRole('combobox', { name: 'Customer Status' })).toBeNull();
    unmount();

    const existing = {
      id: 8,
      companyId: 1,
      displayName: 'Acme Traders',
      name: 'Acme Traders',
      code: '200008',
      backendPartyId: 'party-8',
      gstRegistration: 'Unregistered',
      isActive: true,
      billingAddress: { state: 'Karnataka', country: 'India' },
      shippingAddress: { state: 'Karnataka', country: 'India' },
    };
    updateCustomer.mockResolvedValue({ party: { ...existing, isActive: false } });
    renderForm({ db: { ...db, customers: [existing] }, initialData: existing });

    const status = screen.getByRole('combobox', { name: 'Customer Status' });
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent('Active');

    await user.click(status);
    await user.click(screen.getByRole('option', { name: /Inactive/ }));
    expect(status).toHaveTextContent('Inactive');

    await user.click(screen.getByRole('button', { name: /^Save changes$/ }));
    expect(updateCustomer).toHaveBeenCalledWith('party-8', expect.objectContaining({ isActive: false }));
  });
});

describe('Statutory tab', () => {
  /*
   * TDS is deducted FROM a vendor, not from a customer, so the configuration
   * belongs on the vendor master alone. Asserted here because the two forms now
   * share a layout, and a flag flipped in the shared config would otherwise put
   * a vendor's field on the customer form with nothing to catch it.
   */
  it('does not carry the vendor-only TDS configuration', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('tab', { name: 'Statutory Details' }));
    expect(screen.queryByLabelText('TDS Configuration')).toBeNull();
  });

  /* One place to set it, another to read it — never two places to set it. */
  it('states the GST treatment without letting it be set twice', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('tab', { name: 'Statutory Details' }));
    const shown = screen.getByLabelText('GST Registration / Treatment');
    expect(shown).toHaveValue('Registered');
    /* A select, so it reads as the same control it mirrors — but not one that
       can answer the question a second time. */
    expect(shown).toBeDisabled();
  });
});

describe('the primary contact', () => {
  /*
   * Both masters ask for one contact to be marked primary. Until the flag
   * existed the first row typed was the one every reminder went to, so adding
   * an accounts clerk above the person you deal with redirected the post.
   */
  it('marks one contact, and only one', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('tab', { name: 'Contacts' }));
    await user.type(screen.getByLabelText('Contact name, row 1'), 'R. Nair');
    await user.click(screen.getByRole('button', { name: /Add Contact/i }));
    await user.type(screen.getByLabelText('Contact name, row 2'), 'S. Rao');

    // The first row answers by default until somebody says otherwise.
    expect(screen.getByLabelText('Primary contact, row 1')).toBeChecked();

    await user.click(screen.getByLabelText('Primary contact, row 2'));
    expect(screen.getByLabelText('Primary contact, row 2')).toBeChecked();
    expect(screen.getByLabelText('Primary contact, row 1')).not.toBeChecked();
  });
});

describe('the shipping address', () => {
  const lines = () => screen.getAllByLabelText('Address Line 1');

  it('follows billing while it is tied to it', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('tab', { name: 'Address' }));

    expect(screen.getByLabelText('Same as billing')).toBeChecked();
    await user.type(lines()[0], '4 MG Road');

    /* Not copied on a button press — the same address, so a typo fixed in one
       is fixed in both. */
    expect(lines()[1]).toHaveValue('4 MG Road');
    expect(lines()[1]).toBeDisabled();
  });

  it('keeps what it had and becomes its own once untied', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('tab', { name: 'Address' }));
    await user.type(lines()[0], '4 MG Road');
    await user.click(screen.getByLabelText('Same as billing'));

    expect(lines()[1]).toHaveValue('4 MG Road');
    expect(lines()[1]).toBeEnabled();

    await user.clear(lines()[1]);
    await user.type(lines()[1], 'Plot 9, Peenya');
    expect(lines()[0]).toHaveValue('4 MG Road');
  });
});

describe('a duplicated customer', () => {
  it('copies the terms but not the identity', () => {
    const seed = {
      displayName: 'Acme Traders',
      groupId: '2',
      gstin: '29AABCU9603R1ZM',
      pan: 'AABCU9603R',
      code: 'CUS-000001',
      creditLimit: 100000,
      billingAddress: { line1: '4 MG Road', state: 'Karnataka', country: 'India' },
    };
    render(<CustomerForm db={db} setDb={() => {}} currentCompany={company} seedData={seed} onClose={() => {}} />);

    expect(screen.getByLabelText(/^Customer Name/)).toHaveValue('Acme Traders (copy)');
    expect(screen.queryByDisplayValue('29AABCU9603R1ZM')).toBeNull();
    expect(screen.queryByDisplayValue('CUS-000001')).toBeNull();
  });
});
