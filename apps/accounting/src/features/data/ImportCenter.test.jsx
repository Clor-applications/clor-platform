import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeatureContext } from '@ui/permissions/featureContext';
import { setFeatures } from '@ui/api/features';
import { stageImport, validateImport, commitImport } from '../../api/imports';
import { createLedgerAccount, getLedgerAccounts } from '@ui/api/ledger';
import ImportCenter, { buildImportReviewRows, normalizeJournalTemplate, updateImportJournal, updateImportLines } from './ImportCenter';

vi.mock('@ui/api/features', () => ({ setFeatures: vi.fn(async () => ({})) }));
vi.mock('@ui/api/ledger', () => ({
  createLedgerAccount: vi.fn(async ({ code, name }) => ({ account: { id: `server-${code || name}`, code: code || (name === 'Cash' ? '1101' : ''), name } })),
  getLedgerAccounts: vi.fn(async () => ({ accounts: [{ id: 'phantom', code: '9999', name: 'Server only ledger' }] })),
}));
vi.mock('../../api/imports', () => ({
  listImportSpecs: vi.fn(async () => ({ specs: [
    { docType: 'JOURNAL', label: 'Journal', groupBy: 'entry_ref', columns: [] },
    { docType: 'INVOICE', label: 'Invoice', columns: [] },
  ] })),
  listJournalImportSeries: vi.fn(async () => [{ id: 'series-1', name: 'Default series' }]),
  commitImport: vi.fn(), downloadTemplate: vi.fn(), stageImport: vi.fn(), validateImport: vi.fn(),
}));

describe('invoice import entry', () => {
  it('opens the system file picker directly from Import Invoices', async () => {
    render(<ImportCenter initialDocType="INVOICE" />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Import Invoices' }))[0]);
    expect(screen.getByRole('button', { name: 'Import Invoices' })).toBeInTheDocument();
    expect(screen.getByLabelText('Choose invoice import file')).toHaveAttribute('type', 'file');
  });

  it('shows review table headings before a file is uploaded', async () => {
    render(<ImportCenter initialDocType="INVOICE" />);
    expect(await screen.findByRole('columnheader', { name: 'Invoice No (File)' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Customer' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Paste the file here, or choose one above.')).not.toBeInTheDocument();
  });

  it('groups multiline invoices and reports errors without calling unchecked rows ready', () => {
    const csv = 'invoice_no,date,customer_name,quantity,rate\nINV-1,2026-10-18,"ABC, Ltd",2,100\nINV-1,2026-10-18,"ABC, Ltd",1,50\nINV-2,2026-10-18,XYZ,1,10';
    const unchecked = buildImportReviewRows(csv, 'invoice_no', [], false);
    expect(unchecked).toHaveLength(2);
    expect(unchecked[0]).toMatchObject({ customer: 'ABC, Ltd', amount: 250, status: 'Needs Review' });
    const checked = buildImportReviewRows(csv, 'invoice_no', [{ rowNumber: 4, error: 'Customer not found' }], true);
    expect(checked[0].status).toBe('Ready');
    expect(checked[1].status).toBe('Errors');
    expect(checked[1].remarks.join(' ')).toContain('Customer not found');
  });

  it('allows enabling import from the import page', async () => {
    const reload = vi.fn();
    render(<FeatureContext.Provider value={{ isEnabled: () => false, reload }}>
      <ImportCenter initialDocType="INVOICE" />
    </FeatureContext.Provider>);
    await userEvent.click(await screen.findByRole('button', { name: 'Enable data import' }));
    await waitFor(() => expect(setFeatures).toHaveBeenCalledWith({ imports: true }));
    expect(reload).toHaveBeenCalled();
  });
});

describe('journal import review', () => {
  it('keeps a code-less Cash ledger selectable during correction', async () => {
    const csv = 'Date,Journal No,Transaction series,Ledger Name,Ledger Code,Debit,Credit,Description,Narration\n31-10-2026,2,Default,Cash,,100,,Cash,Opening\n31-10-2026,2,Default,Sales Revenue,4000,,100,Sales,Opening';
    vi.mocked(stageImport).mockResolvedValueOnce({ batch: { id: 'cash-batch' } });
    vi.mocked(validateImport).mockResolvedValueOnce({ batch: { id: 'cash-batch', status: 'VALIDATED' }, issues: [] });
    const db = { chartOfAccounts: [
      { id: 1, companyId: 7, code: '', name: 'Cash', type: 'Asset' },
      { id: 2, companyId: 7, code: '4000', name: 'Sales Revenue', type: 'Income' },
    ] };
    render(<ImportCenter initialDocType="JOURNAL" currentCompany={{ id: 7 }} db={db} />);
    const picker = await screen.findByLabelText('Choose journal entry import file');
    const file = new File([csv], 'cash.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: async () => csv });
    await userEvent.upload(picker, file);
    await waitFor(() => expect(stageImport).toHaveBeenCalledWith(expect.objectContaining({ csv: expect.stringContaining('2026-10-31') })));
    expect(vi.mocked(stageImport).mock.calls[0][0].csv.split('\r\n')[0]).toBe('date,entry_ref,transaction_series,account_name,account_code,debit,credit,description,narration');
    expect(vi.mocked(stageImport).mock.calls[0][0].csv).toContain('Default series,Cash,1101,100');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit journal entry 2' }));
    expect(screen.getByRole('combobox', { name: 'Ledger, line 1' })).toHaveValue('Cash');
    expect(screen.getAllByRole('option', { name: 'Cash' })).toHaveLength(2);
    expect(screen.queryByRole('option', { name: 'Cash · 1101' })).not.toBeInTheDocument();
    expect(createLedgerAccount).toHaveBeenCalledWith(expect.objectContaining({ name: 'Cash', code: '' }));
  });
  it('matches imported ledger names to chart codes and uses chart ledgers in correction', async () => {
    const csv = 'Date,Journal No,Transaction series,Ledger Name,Ledger Code,Debit,Credit,Description,Narration\n2026-10-31,1,Default,Office Rent,,100,,Rent,October\n2026-10-31,1,Default,Bank,, ,100,,October';
    vi.mocked(stageImport).mockResolvedValueOnce({ batch: { id: 'chart-batch' } });
    vi.mocked(validateImport).mockResolvedValueOnce({ batch: { id: 'chart-batch', status: 'VALIDATED' }, issues: [] });
    const company = { id: 7, name: 'Test Company' };
    const db = { chartOfAccounts: [
      { id: 11, companyId: 7, code: 'EXP-11', name: 'Office Rent', type: 'Expense' },
      { id: 12, companyId: 7, code: 'BANK-12', name: 'Bank', type: 'Asset' },
    ] };
    render(<ImportCenter initialDocType="JOURNAL" currentCompany={company} db={db} />);
    const picker = await screen.findByLabelText('Choose journal entry import file');
    const file = new File([csv], 'journals.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: async () => csv });
    await userEvent.upload(picker, file);
    await waitFor(() => expect(stageImport).toHaveBeenCalledWith(expect.objectContaining({ csv: expect.stringContaining('EXP-11') })));
    expect(createLedgerAccount).toHaveBeenCalledWith(expect.objectContaining({ code: 'EXP-11', name: 'Office Rent' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Edit journal entry 1' }));
    expect(screen.getAllByRole('option', { name: 'Office Rent' })).toHaveLength(2);
    expect(screen.queryByRole('option', { name: /Server only ledger/ })).not.toBeInTheDocument();
    expect(getLedgerAccounts).not.toHaveBeenCalled();
  });
  it('downloads the requested journal columns even when the API returns the older template', () => {
    const old = 'Journal No,Date,Ledger Name,Ledger Code,Debit,Credit,Description,Narration\nJV-001,2026-04-01,,1200,5000.00,,,Opening\nJV-001,2026-04-01,,4000,,5000.00,,Opening';
    const normalized = normalizeJournalTemplate(old);
    expect(normalized.split('\r\n')[0]).toBe('Date,Journal No,Transaction series,Ledger Name,Ledger Code,Debit,Credit,Description,Narration');
    const rows = buildImportReviewRows(normalized, 'entry_ref', [], false);
    expect(rows).toHaveLength(1);
    expect(rows[0].number).toBe('1');
    expect(rows[0].lines.every((line) => line.data.transaction_series === 'Default')).toBe(true);
  });
  it('puts the active default series in the downloaded journal template', () => {
    const normalized = normalizeJournalTemplate('date,entry_ref,transaction_series,account_name,account_code,debit,credit,description,narration\n2026-10-31,1,Default,Cash,,100,,,Opening', [], [{ name: 'Default series', isDefault: true }]);
    expect(normalized).toContain('2026-10-31,1,Default series,Cash,,100');
  });
  it('uses Cash by name when the chart Cash ledger has no code', () => {
    const old = 'Journal No,Date,Ledger Name,Ledger Code,Debit,Credit,Description,Narration\nJV-001,2026-04-01,,1200,5000.00,,,Opening\nJV-001,2026-04-01,,4000,,5000.00,,Opening';
    const csv = normalizeJournalTemplate(old, [
      { id: 1, name: 'Cash', code: '', type: 'Asset' },
      { id: 2, name: 'Sales Revenue', code: '4000', type: 'Income' },
    ]);
    const rows = buildImportReviewRows(csv, 'entry_ref', [], false);
    expect(rows[0].lines[0].data).toMatchObject({ account_name: 'Cash', account_code: '' });
    expect(rows[0].lines[1].data).toMatchObject({ account_name: 'Sales Revenue', account_code: '4000' });
  });
  it('shows journal columns and upload action', async () => {
    render(<ImportCenter initialDocType="JOURNAL" />);
    expect(await screen.findByRole('button', { name: 'Import Journals' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Journal transaction series')).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Journal No.' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Debit' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Credit' })).toBeInTheDocument();
  });

  it('rebuilds a corrected journal CSV while preserving its other lines', () => {
    const original = 'entry_ref,date,narration,account_code,debit,credit\nJV-1,31-10-2026,"Rent, October",5000,100,\nJV-1,31-10-2026,"Rent, October",1000,,100';
    const corrected = updateImportLines(original, [{ line: 2, data: { entry_ref: 'JV-1', date: '2026-10-31', narration: 'Rent, October', account_code: '5000', debit: '100', credit: '' } }]);
    const rows = buildImportReviewRows(corrected, 'entry_ref', [], true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ debit: 100, credit: 100, status: 'Ready' });
    expect(rows[0].lines[0].data.date).toBe('2026-10-31');
    expect(rows[0].lines[1].data.date).toBe('31-10-2026');
  });

  it('updates a whole journal, adds a ledger line, and keeps another journal intact', () => {
    const csv = 'entry_ref,date,narration,account_code,debit,credit\nJV-1,31-10-2026,Rent,5000,100,\nJV-1,31-10-2026,Rent,1000,,100\nJV-2,2026-10-31,Other,1000,50,';
    const original = buildImportReviewRows(csv, 'entry_ref', [], true)[0].lines;
    const changed = updateImportJournal(csv, original, { entry_ref: 'JV-1', date: '2026-10-31', narration: 'October rent' }, [
      { data: { account_code: '5000', debit: '75', credit: '', description: 'Rent' } },
      { data: { account_code: '1000', debit: '', credit: '75' } },
      { data: { account_code: '2000', debit: '25', credit: '' } },
    ]);
    const rows = buildImportReviewRows(changed, 'entry_ref', [], true);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-10-31', narration: 'October rent', debit: 100, credit: 75 });
    expect(rows[0].lines[0].data.description).toBe('Rent');
    expect(rows[1].lines[0].data.account_code).toBe('1000');
  });

  it('reads and corrects the displayed journal template headings', () => {
    const csv = 'Date,Journal No,Transaction series,Ledger Name,Ledger Code,Debit,Credit,Description,Narration\n2026-10-31,JV-1,Default,Cash,,100,,Opening,Initial balance\n2026-10-31,JV-1,Default,,4000,,100,,Initial balance';
    const rows = buildImportReviewRows(csv, 'entry_ref', [], true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ number: 'JV-1', narration: 'Initial balance', debit: 100, credit: 100 });
    const changed = updateImportJournal(csv, rows[0].lines, { entry_ref: 'JV-1', date: '2026-11-01', transaction_series: 'Default', narration: 'Revised' }, rows[0].lines);
    expect(changed.split('\r\n')[0]).toBe('Date,Journal No,Transaction series,Ledger Name,Ledger Code,Debit,Credit,Description,Narration');
    expect(buildImportReviewRows(changed, 'entry_ref', [], true)[0].date).toBe('2026-11-01');
  });

  it('opens an imported journal from its row without an Actions column', async () => {
    const csv = 'Date,Journal No,Transaction series,Ledger Name,Ledger Code,Debit,Credit,Description,Narration\n2026-10-31,JV-1,Default,Cash,,100,,Opening,Initial balance\n2026-10-31,JV-1,Default,Sales,, ,100,Revenue,Initial balance';
    vi.mocked(stageImport).mockResolvedValueOnce({ batch: { id: 'batch-1' } });
    vi.mocked(validateImport).mockResolvedValueOnce({ batch: { id: 'batch-1', status: 'VALIDATED', validRows: 2 }, issues: [] });
    vi.mocked(commitImport).mockResolvedValueOnce({ batch: { id: 'batch-1', status: 'COMMITTED', validRows: 2 }, committed: 2, failures: [], postedJournals: [{ serial: 'JV-1', number: 'JE-00001' }] });
    render(<ImportCenter initialDocType="JOURNAL" currentCompany={{ name: 'Test Company' }} />);
    const picker = await screen.findByLabelText('Choose journal entry import file');
    const file = new File([csv], 'journals.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: async () => csv });
    await userEvent.upload(picker, file);
    await userEvent.click(await screen.findByRole('button', { name: 'Post 1 Journals' }));
    await userEvent.click(await screen.findByRole('button', { name: 'View journal entry JV-1' }));
    expect(screen.getByRole('dialog', { name: 'Journal Entry JV-1' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Journal Entry JV-1' })).toHaveTextContent('JE-00001');
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
  });
});
