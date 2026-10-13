import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@ui/api/masters', async (importOriginal) => ({
  ...(await importOriginal()),
  createCustomer: vi.fn(),
  listCustomers: vi.fn(async () => ({ customers: [] })),
  lookupGstin: vi.fn(),
}));

import { CustomerForm } from './CustomerPicker';
import { VendorForm } from './VendorPicker';

/*
 * The shape of the party master, as drawn.
 *
 * The form was one column of eight labelled rows and a table of addresses eight
 * columns wide. It is three cards now — the bar, the identity, the tabs — with
 * the identity in two columns and each address in the shape of an address.
 * These hold the parts of that which are contract rather than styling.
 */

/* src/components/pickers/ → src/ */
const SRC = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const db = {
  customers: [],
  vendors: [],
  chartOfAccounts: [],
  accountGroups: [
    { id: 1, companyId: 1, name: 'Sundry Debtors' },
    { id: 2, companyId: 1, name: 'Sundry Creditors' },
  ],
  accountTypes: [],
};
const company = { id: 1, name: 'Test Co', state: 'Karnataka' };

const renderCustomer = () =>
  render(<CustomerForm db={db} setDb={() => {}} currentCompany={company} onClose={() => {}} />);

describe('the form is three cards, not one', () => {
  it('gives the bar, the identity and the tabs a card each', () => {
    const { container } = renderCustomer();
    /* The caller used to supply a card and the form filled it. It brings its
       own now, or the modal and the page draw it differently. */
    expect(container.querySelectorAll('.ui-card').length).toBeGreaterThanOrEqual(3);
  });

  it('heads each part with what it is for', async () => {
    const user = userEvent.setup();
    renderCustomer();
    expect(screen.getByText('Enter the primary information about your customer.')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Credit Details' }));
    expect(screen.getByText('Set credit terms and limits for this customer.')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Statutory Details' }));
    expect(screen.getByText('Tax and regulatory information for this customer.')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Others' }));
    expect(screen.getByText('Additional settings for this customer.')).toBeInTheDocument();
  });
});

describe('an address reads as an address', () => {
  it('names the two built-in places and what each is for', () => {
    renderCustomer();
    expect(screen.getByText('Primary address for invoices and accounting.')).toBeInTheDocument();
    expect(screen.getByText('Used for delivery and correspondence.')).toBeInTheDocument();
    /* Which one a document is addressed to, said on the card rather than
       inferred from its position in a table. */
    expect(screen.getByText('Primary')).toBeInTheDocument();
  });

  it('keeps the fields of a place together', () => {
    renderCustomer();
    for (const label of ['Address Line 1', 'Address Line 2', 'City', 'Pincode']) {
      expect(screen.getAllByLabelText(label).length).toBeGreaterThanOrEqual(2);
    }
    /* The two pickers say which card they belong to, so a screen reader does
       not hear "Country" twice with nothing to tell them apart. */
    expect(screen.getByLabelText('Country, address 1')).toBeInTheDocument();
    expect(screen.getByLabelText('State, address 2')).toBeInTheDocument();
  });
});

describe('the master is a screen, not a dialog', () => {
  /*
   * The form prints its own title and every way out of it. Opened inside a
   * dialog that also prints a title, the screen said "New Customer" twice and
   * the tabs scrolled inside a box with the list greyed out behind them.
   *
   * Stated against the source, because what is wrong is the call site: nothing
   * may hand a party master to the modal with a title above it.
   */
  it('is not opened anywhere with a dialog title over it', () => {
    const app = readFileSync(join(SRC, 'App.jsx'), 'utf8');
    expect(app).not.toMatch(/title: 'New Customer'/);
    expect(app).not.toMatch(/title: 'New Vendor'/);
  });

  it('leaves the picker\'s inline create untitled, so only the form speaks', () => {
    const picker = readFileSync(join(SRC, 'components/pickers/AccountPicker.jsx'), 'utf8');
    /* The two party modes share the empty title; the ledger and account
       panels keep theirs. */
    expect(picker).toMatch(/mode === 'createCustomer' \|\| mode === 'createVendor'\s*\n\s*\? ''/);
    expect(picker).toMatch(/'Create Ledger'/);
  });
});

describe('the two columns of Basic Details', () => {
  /*
   * Balance Type sat on the far side of the card from the number it qualifies,
   * three columns away from the balance it says Dr or Cr about.
   */
  it('keeps the balance and its side together', () => {
    renderCustomer();
    const balance = screen.getByLabelText('Opening Balance');
    const row = balance.closest('div.grid');
    /* The same column, not the same card: both are FormRows in the left half. */
    expect(row.parentElement.textContent).toContain('Balance Type');
  });

  it('keeps the right column on the left column\'s rows', () => {
    renderCustomer();
    /*
     * The left is rows of a fixed height with a fixed gap. Each label on the
     * right is given a row of its own to sit in, so the group's name lands on
     * the GST line and its control on the GSTIN line. Left to stack at their
     * natural heights the two halves drift a few pixels a row.
     */
    /*
     * Both halves are the same shape — a name beside its control — and each
     * right-hand field shares a row with the left-hand one it says something
     * about: the GSTIN with the registration type that asks for it, the group
     * with the party's name, the currency with the balance it counts.
     */
    const rowOf = (el) => (el.className.match(/lg:row-start-(\d)/) || [])[1];
    expect(rowOf(screen.getByText('Customer Group').closest('div.grid'))).toBe('2');
    expect(rowOf(screen.getByLabelText(/^Customer Name/).closest('div.grid'))).toBe('2');
    expect(rowOf(screen.getByText('Currency').closest('div.grid'))).toBe('3');
    expect(rowOf(screen.getByLabelText('Opening Balance').closest('div.grid'))).toBe('3');
    expect(screen.getByText('Customer Group').closest('div.grid').className).toMatch(/lg:col-start-2\b/);

    /* And a control holding one short word does not run the half-card. */
    /* And both columns' controls are the one width — they differed by
       thirty-seven pixels, the left taking what the label gutter left it and
       the right taking its own cap. */
    expect(screen.getByLabelText('Customer Group').closest('div').className).toContain('max-w-[25rem]');
    expect(screen.getByLabelText(/^Customer Name/).parentElement.className).toContain('max-w-[25rem]');
  });
});

describe('the GSTIN sits beside the question that asks for it', () => {
  /*
   * It used to stack under the registration type, which left the right half of
   * two rows empty and then made the field share one narrow cell with the
   * Fetch button — 77px for a fifteen-character number. Across the row it has
   * the full control width, and nothing below it moves when a party turns out
   * to be unregistered.
   */
  const rowOf = (el) => (el.className.match(/lg:row-start-(\d)/) || [])[1];

  it('keeps the pairs together when the GSTIN row goes', () => {
    render(<VendorForm db={db} setDb={() => {}} currentCompany={company} onClose={() => {}} />);
    const rowOf = (el) => (el.className.match(/lg:row-start-(\d)/) || [])[1];
    expect(rowOf(screen.getByLabelText(/^Vendor Name/).closest('div.grid'))).toBe('2');
    expect(rowOf(screen.getByText('Vendor Group').closest('div.grid'))).toBe('2');
    expect(rowOf(screen.getByLabelText('Opening Balance').closest('div.grid'))).toBe('3');
    expect(rowOf(screen.getByText('Currency').closest('div.grid'))).toBe('3');
  });

  it('closes the gap on a party with no GSTIN', () => {
    render(<VendorForm db={db} setDb={() => {}} currentCompany={company} onClose={() => {}} />);
    expect(screen.queryByPlaceholderText('Enter 15 digit GSTIN')).toBeNull();
    /* Name takes the row GSTIN would have had. */
    expect(rowOf(screen.getByLabelText(/^Vendor Name/).closest('div.grid'))).toBe('2');
  });

  it('puts it in the right half of the first row, beside the registration type', () => {
    renderCustomer();
    const gstin = screen.getByPlaceholderText('Enter 15 digit GSTIN').closest('div.grid');
    expect(rowOf(gstin)).toBe('1');
    expect(gstin.className).toMatch(/lg:col-start-2\b/);
    expect(rowOf(screen.getByLabelText(/^Customer Name/).closest('div.grid'))).toBe('2');
  });

  it('leaves the rows where they are when the registration is switched', async () => {
    const user = userEvent.setup();
    renderCustomer();
    await user.click(screen.getByRole('radio', { name: 'Unregistered' }));
    expect(screen.queryByPlaceholderText('Enter 15 digit GSTIN')).toBeNull();
    expect(rowOf(screen.getByLabelText(/^Customer Name/).closest('div.grid'))).toBe('2');
  });
});

describe('a delete looks like a delete', () => {
  /*
   * The trash on a contact row was the same grey as the field controls beside
   * it, so the one irreversible thing on the tab read as one more of them.
   * Every other delete in the product carries the negative token.
   */
  it('carries the negative token on the contact row', async () => {
    const user = userEvent.setup();
    renderCustomer();
    await user.click(screen.getByRole('tab', { name: 'Contacts' }));
    const icon = screen.getByRole('button', { name: 'Remove contact 1' }).querySelector('svg');
    expect(icon.getAttribute('class')).toContain('--neg');
  });

  it('carries it on an address card too', async () => {
    const user = userEvent.setup();
    renderCustomer();
    await user.click(screen.getByRole('button', { name: /Add Address/i }));
    const icon = screen.getByRole('button', { name: /Remove Shipping 2/i }).querySelector('svg');
    expect(icon.getAttribute('class')).toContain('--neg');
  });
});

describe('the statutory tab', () => {
  /* A box the width of the card under two half-width ones reads as a different
     kind of field. It is not one. */
  it('keeps Others in a column with the rest', async () => {
    const user = userEvent.setup();
    renderCustomer();
    await user.click(screen.getByRole('tab', { name: 'Statutory Details' }));
    const others = screen.getByLabelText(/^Others/);
    expect(others.closest('div').className).not.toContain('col-span-2');
  });
});

describe('the address cards', () => {
  /*
   * A row of four controls read as two pairs: Country and State were a
   * picker's own padding and inherited 16px type, two pixels taller and a size
   * bigger than the City box beside them.
   */
  it('gives the pickers the metrics of the fields they stand with', () => {
    renderCustomer();
    const country = screen.getByLabelText('Country, address 1');
    const city = screen.getAllByLabelText('City')[0];
    expect(country.className).toContain('ui-input');
    expect(city.className).toContain('ui-input');
  });

  it('marks the two built-in places apart by colour', () => {
    renderCustomer();
    const [billing, shipping] = screen
      .getAllByText(/^(Billing|Shipping) Address$/)
      .map((el) => el.parentElement.parentElement.querySelector('span'));
    expect(billing.getAttribute('style')).toContain('--brand');
    /* Blue on the one goods go to — a token, so it holds in dark mode too. */
    expect(shipping.getAttribute('style')).toContain('--ov-blue');
  });

  it('names each card a shade heavier than the fields under it', () => {
    renderCustomer();
    expect(screen.getByText('Billing Address').className).toContain('font-semibold');
    expect(screen.getByText('Shipping Address').className).toContain('font-semibold');
  });
});

describe('the contacts table', () => {
  /*
   * The radio sat under the P of PRIMARY and the delete under the last letter
   * of ACTIONS, so both read as belonging to the column beside them. And the
   * delete was the smallest target on the tab — 32px in a 36px row — which is
   * the wrong size for the only control here you cannot undo.
   */
  const cellFor = async (user, label) => {
    await user.click(screen.getByRole('tab', { name: 'Contacts' }));
    return screen.getByLabelText(label).closest('td');
  };

  it('centres the primary radio under its heading', async () => {
    const user = userEvent.setup();
    renderCustomer();
    const cell = await cellFor(user, 'Primary contact, row 1');
    expect(cell.className).toContain('text-center');
    expect(screen.getByRole('columnheader', { name: 'Primary' }).className).toContain('text-center');
    /* `.ui-radio` is display:grid, so it is a block and the cell's text-align
       does not move it — it needs the margin of its own. */
    expect(screen.getByLabelText('Primary contact, row 1').className).toContain('mx-auto');
  });

  it('centres the delete under Actions and gives it a real target', async () => {
    const user = userEvent.setup();
    renderCustomer();
    await user.click(screen.getByRole('tab', { name: 'Contacts' }));
    const button = screen.getByRole('button', { name: 'Remove contact 1' });
    expect(button.closest('td').className).toContain('text-center');
    expect(button.className).toMatch(/!h-9/);
    expect(button.className).toMatch(/!w-9/);
    expect(screen.getByRole('columnheader', { name: 'Actions' }).className).toContain('text-center');
  });
});

describe('remarks', () => {
  it('gives a note about the party somewhere to go', async () => {
    const user = userEvent.setup();
    renderCustomer();
    await user.click(screen.getByRole('tab', { name: 'Others' }));
    const box = screen.getByLabelText('Remarks');
    await user.type(box, 'Pays on the 10th, never before.');
    expect(box).toHaveValue('Pays on the 10th, never before.');
  });
});

describe('notes may be switched off for a party', () => {
  it('offers the switch, on by default', async () => {
    const user = userEvent.setup();
    renderCustomer();
    await user.click(screen.getByRole('tab', { name: 'Credit Details' }));
    const box = screen.getByLabelText('Allow credit notes for this customer');
    expect(box).toBeChecked();
    await user.click(box);
    expect(box).not.toBeChecked();
  });

  it('says debit notes on the vendor, which is what a vendor gets', async () => {
    const user = userEvent.setup();
    render(<VendorForm db={db} setDb={() => {}} currentCompany={company} onClose={() => {}} />);
    await user.click(screen.getByRole('tab', { name: 'Credit Details' }));
    expect(screen.getByLabelText('Allow debit notes for this vendor')).toBeInTheDocument();
  });
});

describe('the money field says what money it is', () => {
  it('carries the rupee sign inside the opening balance', () => {
    renderCustomer();
    const field = screen.getByLabelText('Opening Balance');
    expect(within(field.parentElement).getByText('₹')).toBeInTheDocument();
  });
});
