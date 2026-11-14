import React, { useMemo } from 'react';
import { FileSpreadsheet } from 'lucide-react';

import PrintDownloadFrame from '@ui/components/PrintDownloadFrame';
import { runListExport } from '@ui/components/list/exportMenu';
import { formatMoney } from '@ui/utils/money';
import { formatDateIn } from '@ui/utils/dates';

const dateLabel = (value, company) => formatDateIn(value, company) || '—';

const companyAddress = (company) => {
  const address = company?.registeredAddress || company?.address;
  const profile = company?.profile?.companySettings || {};
  if (typeof address === 'string') return [address, company?.city || profile.regCity, company?.state || profile.regStateName, company?.pincode || profile.regPincode].filter(Boolean).join(', ');
  if (address && typeof address === 'object') return [address.line1, address.line2, address.city, address.state, address.pincode].filter(Boolean).join(', ');
  return [profile.regAddress1, profile.regAddress2, profile.regCity, profile.regStateName, profile.regPincode].filter(Boolean).join(', ');
};

export default function JournalEntryDetail({ entry, db, company, onBack }) {
  const accounts = useMemo(() => new Map((db?.chartOfAccounts || []).map((account) => [String(account.id), account])), [db?.chartOfAccounts]);
  const lines = (Array.isArray(entry?.lines) ? entry.lines : []).map((line) => {
    const account = accounts.get(String(line.accountId));
    return {
      ...line,
      accountCode: line.accountCode || account?.code || '',
      accountName: line.accountName || account?.name || 'Unknown ledger',
      debit: Number(line.debit || 0),
      credit: Number(line.credit || 0),
    };
  });
  const debit = lines.reduce((sum, line) => sum + line.debit, 0);
  const credit = lines.reduce((sum, line) => sum + line.credit, 0);
  const address = companyAddress(company);

  const exportExcel = () => runListExport({
    format: 'xlsx',
    fileName: `Journal_${entry.number || entry.id}`,
    title: `Journal Entry ${entry.number || ''}`.trim(),
    subtitle: `${company?.name || 'Company'} · ${dateLabel(entry.date, company)} · ${entry.narration || 'No narration'}`,
    sheetName: 'Journal Entry',
    columns: [
      { key: 'accountCode', label: 'Ledger Code' },
      { key: 'accountName', label: 'Ledger' },
      { key: 'description', label: 'Description' },
      { key: 'debit', label: 'Debit' },
      { key: 'credit', label: 'Credit' },
    ],
    rows: [...lines, { accountCode: '', accountName: 'Total', debit, credit }],
  });

  return <div className="journal-detail-page">
    <PrintDownloadFrame
      title={`Journal Entry ${entry.number || ''}`.trim()}
      fileBase={entry.number || `journal-${entry.id}`}
      onBack={onBack}
      downloadLabel="Export PDF"
      extraActions={<button type="button" className="ui-btn ui-btn-secondary" onClick={exportExcel}><FileSpreadsheet size={16} /> Export Excel</button>}
    >
      <article className="journal-voucher-paper">
        <header className="journal-voucher-head">
          <h1>{company?.name || 'Company'}</h1>
          {address ? <p>{address}</p> : null}
          {company?.gstin ? <p>GSTIN: {company.gstin}</p> : null}
          <h2>Journal Voucher</h2>
        </header>
        <div className="journal-voucher-meta">
          <div><span>Voucher No.</span><strong>{entry.number || '—'}</strong></div>
          <div><span>Date</span><strong>{dateLabel(entry.date, company)}</strong></div>
          {entry.backendEntryId ? <div><span>Ledger posting</span><strong>{entry.backendEntryId}</strong></div> : null}
        </div>
        <table className="journal-voucher-lines">
          <thead><tr><th scope="col">#</th><th scope="col">Ledger</th><th scope="col">Description</th><th scope="col" className="ui-num">Debit</th><th scope="col" className="ui-num">Credit</th></tr></thead>
          <tbody>{lines.map((line, index) => <tr key={`${line.accountId || 'line'}-${index}`}>
            <td>{index + 1}</td>
            <td><strong>{line.accountName}</strong>{line.accountCode ? <small>{line.accountCode}</small> : null}</td>
            <td>{line.description || '—'}</td>
            <td className="ui-num">{line.debit ? formatMoney(line.debit, company) : '—'}</td>
            <td className="ui-num">{line.credit ? formatMoney(line.credit, company) : '—'}</td>
          </tr>)}</tbody>
          <tfoot><tr><th colSpan="3">Total</th><th className="ui-num">{formatMoney(debit, company)}</th><th className="ui-num">{formatMoney(credit, company)}</th></tr></tfoot>
        </table>
        <section className="journal-voucher-narration"><span>Narration</span><p>{entry.narration || '—'}</p></section>
      </article>
    </PrintDownloadFrame>
  </div>;
}
