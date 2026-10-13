/**
 * Where the fields sit.
 *
 * The receipt follows the same 60/40 structure as the expense voucher. Account
 * and instrument details stay on the left, document identity stays on the
 * right, and narration closes the form after allocation and TDS.
 */
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/api/payments', () => ({
  createPayment: vi.fn(async () => ({})),
  listPaymentModes: vi.fn(async () => []),
}));

import RecordReceiptForm from './RecordReceiptForm';

const COMPANY = { id: 1, name: 'Neev Steels', state: 'Karnataka' };
/* TDS is a company setting, and the section is not drawn without it. */
const COMPANY_TDS = {
  ...COMPANY,
  profile: { taxCompliances: { tds: { enabled: true, tan: 'BLRN12345F' } } },
};

const db0 = {
  companies: [COMPANY],
  customers: [],
  invoices: [],
  creditNotes: [],
  payments: [],
  accountGroups: [{ id: 21, companyId: 1, name: 'Indirect Income', parentGroupId: null }],
  chartOfAccounts: [{ id: 401, companyId: 1, name: 'Interest Received', groupId: 21 }],
};

const Host = ({ tds = false }) => {
  const [db, setDb] = useState(db0);
  return (
    <RecordReceiptForm
      db={db}
      setDb={setDb}
      currentCompany={tds ? COMPANY_TDS : COMPANY}
      screenTitle="New Receipt"
      onClose={() => {}}
    />
  );
};

describe('the head of the receipt', () => {
  it('uses the same 60/40 split as the expense form', () => {
    render(<Host />);
    const heading = screen.getByText('Receipt Details');
    const grid = heading.closest('section').querySelector('.grid');
    expect(grid.className).toMatch(/lg:grid-cols-12/);
    expect(grid.children[0].className).toMatch(/lg:col-span-7/);
    expect(grid.children[1].className).toMatch(/lg:col-span-5/);
    expect(grid.children[1].getAttribute('style')).toMatch(/border-inline-start/);
  });

  /*
   * Six fields in three columns, two rows — and each second-row field sits
   * under the one it qualifies. With a three-column grid that is a statement
   * about DOM order: cell 4 falls under cell 1, 5 under 2, 6 under 3.
   */
  it('keeps account and instrument fields on the left and voucher identity on the right', () => {
    render(<Host />);
    const grid = screen.getByText('Receipt Details').closest('section').querySelector('.grid');
    const [left, right] = [...grid.children];
    expect(within(left).getByText(/Received into/)).toBeInTheDocument();
    expect(within(left).getByLabelText(/Reference \/ UTR \/ Cheque No\./)).toBeInTheDocument();
    expect(within(left).getByLabelText('Receipt Mode')).toBeInTheDocument();
    expect(within(right).getByText(/Receipt No\./)).toBeInTheDocument();
    expect(within(right).getByText(/Receipt Date/)).toBeInTheDocument();
    expect(within(grid).queryByText(/Narration \/ Description/)).toBeNull();
  });

  it('opens the mode on what the account implies, and lets it be changed', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<Host />);
    const mode = screen.getByLabelText('Receipt Mode');
    /* No account chosen yet, so the field falls back rather than blanking. */
    expect(mode.value).toBe('Cash');
    await user.selectOptions(mode, 'NEFT');
    expect(mode.value).toBe('NEFT');
  });

  it('names the screen and says what it is for', () => {
    render(<Host />);
    expect(screen.getByRole('heading', { name: 'New Receipt' })).toBeInTheDocument();
    expect(screen.getByText(/Record money received into your business/)).toBeInTheDocument();
  });
});

describe('the receipt totals', () => {
  it('keeps the on-account line for the receipts that have one', () => {
    render(<Host />);
    /* Nothing allocated, nothing waiting — so the line is not drawn at all
       rather than reading nought on every receipt. */
    expect(screen.queryByText('On account (unallocated)')).toBeNull();
  });
});

describe('the allocation table', () => {
  const headers = () =>
    [...screen.getByText(/Ledger allocation/i).closest('section').querySelectorAll('th')]
      .map((th) => th.textContent.replace('*', '').trim());

  it('gives the bills a column of their own, between the amount and the action', () => {
    render(<Host />);
    /* The amount used to be pushed to the far right of whatever the ledger
       column left over, so a figure sat half a screen from its own row, and
       the bills link shared the amount's cell. */
    expect(headers()).toEqual(['#', 'Ledger', 'Amount', 'Outstanding Bills', 'Action']);
  });

  it('keeps the ledger from eating the row', () => {
    render(<Host />);
    const table = screen.getByText(/Ledger allocation/i).closest('section').querySelector('table');
    const [, ledger, amount] = [...table.querySelectorAll('th')];
    expect(ledger.style.width).toBe('34%');
    expect(amount.style.width).toBe('20%');

    /* And the amount fills its cell rather than hugging one edge of it. */
    expect(screen.getByLabelText(/Amount, allocation row 1/i).className).toMatch(/w-full/);
  });

  it('does not cry unallocated before anything has been entered', () => {
    render(<Host />);
    expect(screen.queryByText('Unallocated')).toBeNull();
  });

  it('puts Add Row below the rows it adds to', () => {
    render(<Host />);
    const table = screen.getByText(/Ledger allocation/i).closest('section').querySelector('table');
    const addRow = screen.getByRole('button', { name: /Add Row/i });
    /* DOCUMENT_POSITION_FOLLOWING: the button comes after the table. */
    expect(table.compareDocumentPosition(addRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

/**
 * The acceptance list, walked against the rendered screen.
 *
 * Every element that has to be there, asserted in one place — because the
 * things that kept going missing were never the ones under test, and a list
 * checked by eye is a list that drifts.
 */
describe('the page reads in the order it is worked in', () => {
  it('goes details, allocation, TDS, then narration', () => {
    render(<Host tds />);
    const sections = [...document.querySelectorAll('h3')].map((h) => h.textContent.trim());
    /* TDS used to sit above the allocation, asking what was withheld from a
       figure that had not been named yet. */
    expect(sections).toEqual([
      'New Receipt',
      'Receipt Details',
      'Ledger allocation',
      'TDS (optional)',
    ]);
    const order = ['Receipt Details', 'Ledger allocation', 'TDS (optional)', 'Narration / Description'];
    const tops = order.map((t) => {
      const el = t === 'Narration / Description' ? screen.getByLabelText(t) : screen.getByText(t);
      return [...document.querySelectorAll('*')].indexOf(el);
    });
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
  });
});

describe('nothing on the screen has gone missing', () => {
  const CHECKS = [
    ['Receipt Details', () => screen.getByText('Receipt Details')],
    ['Receive into', () => screen.getByText(/Received into/)],
    ['Receipt No.', () => screen.getByText(/Receipt No\./)],
    ['Receipt Date', () => screen.getByText(/Receipt Date/)],
    ['Receipt Mode', () => screen.getByLabelText('Receipt Mode')],
    ['Reference / UTR / Cheque No.', () => screen.getByLabelText(/Reference \/ UTR \/ Cheque No\./)],
    ['Narration / Description', () => screen.getByLabelText('Narration / Description')],
    ['Ledger allocation', () => screen.getByText(/Ledger allocation/i)],
    ['Ledger field', () => screen.getByLabelText(/Account, allocation row 1/i)],
    ['Amount field', () => screen.getByLabelText(/Amount, allocation row 1/i)],
    ['Add Row', () => screen.getByRole('button', { name: /Add Row/i })],
    ['TDS section', () => screen.getByText('TDS (optional)')],
    ['TDS Ledger', () => screen.getByLabelText('TDS Ledger')],
    ['TDS Amount', () => screen.getByLabelText('TDS Amount')],
  ];

  it('has every one of them', () => {
    render(<Host tds />);
    const missing = CHECKS.filter(([, get]) => {
      try { get(); return false; } catch { return true; }
    }).map(([name]) => name);
    expect(missing).toEqual([]);
  });
});
