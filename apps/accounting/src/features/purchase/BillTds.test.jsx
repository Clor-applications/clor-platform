import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Warehouses on, everything else off.
 *
 * The bill form hides its warehouse field unless the feature is on, so a mock
 * that answers false to everything renders a form these tests then cannot
 * find their way around. BillBranch.test.jsx was given a switchable version
 * when that gate arrived; its five siblings were not, and every one of them
 * has been red since.
 */
vi.mock('@ui/permissions/useFeatures', () => ({
  useFeatures: () => ({ isEnabled: (key) => key === 'warehouses' }),
}));
vi.mock('@ui/api/purchaseDocs', () => ({
  createDocApi: vi.fn(async () => ({})),
  updateDocApi: vi.fn(async () => ({})),
  hasApiSession: () => false,
}));

import { BillForm } from './index';

/**
 * TDS on a purchase.
 *
 * On the buy side the deduction is the company's own obligation: the vendor is
 * paid short and the difference is owed to the government until it is
 * deposited. So it is not a section picked out of the Act — it is one of the
 * ledgers the company keeps under TDS Payable, and the rate follows from
 * whichever is chosen.
 *
 * What must not move is the bill: reducing the total would understate input
 * GST and lose part of what the vendor is owed. Only the cash that leaves
 * changes.
 */

/* TDS deducts nothing at all unless the company has switched it on — §2. */
const COMPANY = {
  id: 1,
  name: 'Neev Steels',
  gstin: '29ABCDE1234F1Z5',
  state: 'Karnataka',
  profile: { taxCompliances: { tds: { enabled: true, tan: 'BLRN12345F' } } },
};

const GROUPS = [
  { id: 10, companyId: 1, name: 'Duties & Taxes', parentGroupId: null },
  { id: 11, companyId: 1, name: 'TDS Payable', parentGroupId: 10 },
  { id: 12, companyId: 1, name: 'TDS Receivable', parentGroupId: 10 },
];

const CONTRACTOR = 'CONTRACTOR_SUB_CONTRACTOR';
const PROFESSIONAL = 'PROFESSIONAL_SERVICES';

const LEDGERS = [
  { id: 101, companyId: 1, name: 'TDS on Contractors', groupId: 11, tdsNatureCode: CONTRACTOR },
  { id: 102, companyId: 1, name: 'TDS on Professional Fees', groupId: 11, tdsNatureCode: PROFESSIONAL },
  { id: 103, companyId: 1, name: 'TDS Receivable 194C', groupId: 12, tdsNatureCode: CONTRACTOR },
];

const dbWith = (over = {}) => ({
  companies: [COMPANY],
  vendors: [
    { id: 9, companyId: 1, name: 'Steel Supply Co', displayName: 'Steel Supply Co', pan: 'AABCU9603R', tdsApplicable: true },
  ],
  items: [{ id: 11, companyId: 1, name: 'MS Angle 50mm', gstRate: 18, unit: 'Nos', purchasePrice: 100 }],
  accountGroups: GROUPS,
  chartOfAccounts: LEDGERS,
  bills: [],
  purchaseOrders: [],
  batches: [],
  uoms: [],
  gstRates: [],
  debitNotes: [],
  tdsTransactions: [],
  ...over,
});

const Host = ({ db: seed = dbWith(), initialData = null, onSaved = () => {} }) => {
  const [db, setDb] = useState(seed);
  return (
    <BillForm
      db={db}
      setDb={(next) => {
        const value = typeof next === 'function' ? next(db) : next;
        onSaved(value);
        setDb(value);
      }}
      currentCompany={db.companies[0]}
      initialData={initialData}
      branches={[{ id: 'b1', companyId: 1, name: 'Bengaluru' }]}
      warehouses={[{ id: 'w1', companyId: 1, name: 'Main Store', branchId: 'b1' }]}
      onClose={() => {}}
    />
  );
};

describe('editing a bill with TDS', () => {
  beforeEach(() => localStorage.clear());

  it('replaces the bill and its TDS event instead of creating duplicates', async () => {
    const user = userEvent.setup();
    const existingBill = {
      id: 7,
      companyId: 1,
      number: 'BILL-7',
      date: '2026-09-26',
      dueDate: '2026-10-26',
      vendorId: 9,
      vendorName: 'Steel Supply Co',
      warehouseId: 'w1',
      branchId: 'b1',
      status: 'Partial',
      paidAmount: 10000,
      items: [{ itemId: 11, description: 'MS Angle 50mm', quantity: 1, rate: 50000, gstRate: 18, hsnSac: '' }],
      subtotal: 50000,
      cgstTotal: 4500,
      sgstTotal: 4500,
      igstTotal: 0,
      gstTotal: 9000,
      total: 59000,
      tdsLedgerId: '101',
      tdsNatureCode: CONTRACTOR,
      tdsSection: '194C',
      tdsRate: 2,
      tdsAmount: 1000,
      netPayable: 58000,
    };
    const existingEvent = {
      id: 30,
      companyId: 1,
      sourceType: 'bill',
      sourceId: 7,
      sourceNumber: 'BILL-7',
      status: 'Posted',
    };
    let savedDb = null;

    render(
      <Host
        db={dbWith({ bills: [existingBill], tdsTransactions: [existingEvent] })}
        initialData={existingBill}
        onSaved={(next) => { savedDb = next; }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Update Bill' }));
    await waitFor(() => expect(savedDb).not.toBeNull());

    expect(savedDb.bills).toHaveLength(1);
    expect(savedDb.bills[0]).toMatchObject({ id: 7, number: 'BILL-7', status: 'Partial', paidAmount: 10000 });
    expect(savedDb.tdsTransactions).toHaveLength(1);
    expect(savedDb.tdsTransactions[0]).toMatchObject({ id: 30, sourceType: 'bill', sourceId: 7 });
  });
});

/** A bill for one line at `rate`, ready to save. */
const fillBill = async (user, rate) => {
  await user.click(screen.getByRole('combobox', { name: 'Warehouse *' }));
  await user.click(await screen.findByRole('option', { name: 'Main Store' }));
  await user.click(screen.getByPlaceholderText('Type a vendor name'));
  await user.click(await screen.findByRole('option', { name: /Steel Supply Co/ }));
  /* The item field is a type-ahead: click it, then take the suggestion. */
  await user.click(screen.getByPlaceholderText('Type an item name or code'));
  await user.click(await screen.findByRole('option', { name: /MS Angle 50mm/ }));

  const row = document.querySelector('[data-line-row="0"]');
  const numbers = row.querySelectorAll('input[type="number"]');
  /* One change rather than five keystrokes: typing digit by digit into a
     controlled number field re-renders the grid between them, and a dropped
     keystroke made this helper flaky. */
  fireEvent.change(numbers[1], { target: { value: String(rate) } });
};

/** Open the panel and choose a nature — the ledger then follows from it. */
const chooseNature = async (user, natureCode) => {
  await user.click(screen.getByRole('button', { name: /TDS deduction/ }));
  const ledgerId = natureCode === PROFESSIONAL ? '102' : '101';
  await user.selectOptions(screen.getByLabelText('TDS'), ledgerId);
};

describe('choosing what to deduct against', () => {
  beforeEach(() => localStorage.clear());

  it('offers the configured TDS ledgers in one selector', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: /TDS deduction/ }));

    const options = [...screen.getByLabelText('TDS').options].map((o) => o.textContent);
    expect(options).toContain('TDS on Contractors');
    expect(options).toContain('TDS on Professional Fees');
  });

  /* The payable ledger is inferred from the nature. Asking for both makes the
     same accounting choice appear twice and allows an unnecessary mismatch. */
  it('derives the percentage from the selected ledger without a section selector', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await chooseNature(user, CONTRACTOR);

    expect(screen.queryByLabelText('TDS section')).not.toBeInTheDocument();
    // With no vendor selected there is no PAN on the transaction yet, so the
    // engine correctly surfaces the statutory 20% no-PAN rate immediately.
    expect(screen.getByLabelText('%')).toHaveValue(20);
    expect(screen.queryByLabelText('Payee')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });

  /* Prompt 13's first trigger: the VENDOR's own applicability. A vendor
     carrying a default nature deducts without the chooser being opened —
     the compact panel is for changing the answer, not for getting one. */
  it('deducts automatically for a vendor whose TDS profile names a nature', async () => {
    const user = userEvent.setup();
    const vendors = [
      { id: 9, companyId: 1, name: 'Steel Supply Co', displayName: 'Steel Supply Co', pan: 'AABCU9603R', tdsApplicable: true, tdsNatureCode: CONTRACTOR },
    ];
    render(<Host db={dbWith({ vendors })} />);
    await fillBill(user, 100000);

    /* No click on the opener — the engine already answers from the party
       profile and shows the deduction once in the compact TDS row. */
    expect(await screen.findByLabelText('TDS amount')).toHaveTextContent(/2,000\.00/);
    expect(screen.queryByText(/Less: TDS/)).not.toBeInTheDocument();
  });

  it('deducts nothing at all while TDS is switched off for the company', () => {
    const off = { ...COMPANY, profile: { taxCompliances: { tds: { enabled: false } } } };
    render(<Host db={dbWith({ companies: [off] })} />);
    expect(screen.getByRole('button', { name: /TDS deduction/ })).toBeDisabled();
    expect(screen.getByText(/TDS is switched off for this company/)).toBeInTheDocument();
  });
});

describe('the figure the ledger produces', () => {
  beforeEach(() => localStorage.clear());

  it('deducts at the rate of the chosen ledger, under the total', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await fillBill(user, 50000);
    await chooseNature(user, CONTRACTOR);

    /* 194C at 2% on the taxable value, not on the GST-inclusive total. */
    expect(screen.getByText('Net payable:')).toBeInTheDocument();
    expect(screen.getByText(/− ₹1,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/₹58,000\.00/)).toBeInTheDocument();
  });

  it('follows the other ledger to the other rate', async () => {
    const user = userEvent.setup();
    render(<Host />);
    /* 194J(b)'s limit is 50,000 for the year and the test of it is strictly
       greater, so the bill has to clear it rather than meet it. */
    await fillBill(user, 60000);
    await chooseNature(user, PROFESSIONAL);

    /* Professional services, 10%. */
    expect(screen.getByText(/− ₹6,000\.00/)).toBeInTheDocument();
  });

  /* Nothing is due below the threshold, and a figure that simply failed to
     appear would be indistinguishable from a broken feature. */
  it('deducts nothing below the threshold, and says why', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await fillBill(user, 10000);
    await chooseNature(user, CONTRACTOR);

    expect(screen.getByText(/No deduction yet/)).toBeInTheDocument();
    expect(screen.queryByText('Net payable:')).toBeNull();
  });

  it('takes a rate typed over the ledger’s own', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await fillBill(user, 50000);
    await chooseNature(user, CONTRACTOR);

    const rate = screen.getByLabelText('Rate (%)');
    fireEvent.change(rate, { target: { value: '20' } });

    /* A certificate under section 197, or a vendor with no PAN, is a fact
       about this bill rather than about the ledger. */
    expect(await screen.findByText(/− ₹10,000\.00/)).toBeInTheDocument();
  });
});

describe('what is saved', () => {
  beforeEach(() => localStorage.clear());

  it('records the ledger, the section, the rate and the amount', async () => {
    const user = userEvent.setup();
    let saved = null;
    render(<Host onSaved={(next) => { saved = next; }} />);

    await fillBill(user, 50000);
    await chooseNature(user, CONTRACTOR);
    await user.click(screen.getByRole('button', { name: 'Create Bill' }));

    const bill = (saved?.bills || []).at(-1);
    expect(bill?.tdsLedgerId).toBe('101');
    expect(bill?.tdsNatureCode).toBe(CONTRACTOR);
    expect(bill?.tdsSection).toBe('194C');
    expect(bill?.tdsRate).toBe(2);
    expect(bill?.tdsAmount).toBe(1000);
    /* The rule version it was computed under — history must not move when the
       rule master does. */
    expect(bill?.tdsRuleVersionId).toBeTruthy();
  });

  /* The liability to the vendor is the whole bill; the deduction moves cash,
     not what was purchased. */
  it('leaves the bill total alone and states the net separately', async () => {
    const user = userEvent.setup();
    let saved = null;
    render(<Host onSaved={(next) => { saved = next; }} />);

    await fillBill(user, 50000);
    await chooseNature(user, CONTRACTOR);
    await user.click(screen.getByRole('button', { name: 'Create Bill' }));

    const bill = (saved?.bills || []).at(-1);
    expect(bill?.total).toBe(59000);
    expect(bill?.netPayable).toBe(58000);
  });

  it('records nothing where no deduction was chosen', async () => {
    const user = userEvent.setup();
    let saved = null;
    render(<Host onSaved={(next) => { saved = next; }} />);

    await fillBill(user, 50000);
    await user.click(screen.getByRole('button', { name: 'Create Bill' }));

    const bill = (saved?.bills || []).at(-1);
    expect(bill?.tdsAmount).toBe(0);
    expect(bill?.tdsSection).toBe('');
    expect(bill?.netPayable).toBe(59000);
  });
});

describe('the compliance record', () => {
  beforeEach(() => localStorage.clear());

  /*
   * The bill is the accounting document; the TDS transaction is the compliance
   * record the register, the challan and the quarterly return all read. It
   * carries its own snapshot, so editing the vendor or the rule tomorrow
   * cannot restate what was deducted today.
   */
  it('is written beside the bill, with its own snapshot', async () => {
    const user = userEvent.setup();
    let saved = null;
    render(<Host onSaved={(next) => { saved = next; }} />);

    await fillBill(user, 50000);
    await chooseNature(user, CONTRACTOR);
    await user.click(screen.getByRole('button', { name: 'Create Bill' }));

    await waitFor(() => expect((saved?.tdsTransactions || []).length).toBe(1));
    const event = (saved?.tdsTransactions || []).at(-1);
    expect(event).toMatchObject({
      sourceType: 'bill',
      partyId: 9,
      panSnapshot: 'AABCU9603R',
      tanSnapshot: 'BLRN12345F',
      natureCode: CONTRACTOR,
      sectionCode: '194C',
      baseAmount: 50000,
      rate: 2,
      tdsAmount: 1000,
      ledgerId: '101',
      status: 'Posted',
    });
    expect(event.ruleVersionId).toBeTruthy();
    expect(event.returnQuarter).toMatch(/Q[1-4]$/);
  });

  it('writes nothing where nothing was deducted', async () => {
    const user = userEvent.setup();
    let saved = null;
    render(<Host onSaved={(next) => { saved = next; }} />);

    await fillBill(user, 50000);
    await user.click(screen.getByRole('button', { name: 'Create Bill' }));

    expect(saved?.tdsTransactions || []).toHaveLength(0);
  });
});
