import React, { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import Drawer from '@ui/components/ui/Drawer';
import { formatMoney } from '@ui/utils/money';
import { formatDateIn } from '@ui/utils/dates';
import { getCustomerDisplayName, getVendorDisplayName } from '@ui/utils/contacts';

const amount = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const live = (row) => !['draft', 'cancelled', 'void', 'reversed'].includes(String(row?.status || '').toLowerCase());
const sameParty = (row, companyId, partyId, key) => String(row?.companyId) === String(companyId) && String(row?.[key]) === String(partyId);

export default function PartyBalanceButton({ db, currentCompany, partyId, kind }) {
  const [open, setOpen] = useState(false);
  const isVendor = kind === 'vendor';
  const party = (isVendor ? db?.vendors : db?.customers)?.find((row) => String(row.id) === String(partyId) && String(row.companyId) === String(currentCompany?.id));
  const name = party ? (isVendor ? getVendorDisplayName(party) : getCustomerDisplayName(party)) : '';
  const rows = useMemo(() => {
    if (!party) return [];
    const key = isVendor ? 'vendorId' : 'customerId';
    const from = (collection, type, sign, value) => (db?.[collection] || [])
      .filter((row) => sameParty(row, currentCompany?.id, partyId, key) && live(row))
      .map((row) => ({ id: `${collection}-${row.id}`, date: row.date || row.createdAt, number: row.number || row.reference || '—', type, change: sign * amount(value(row)) }));
    const opening = amount(party.openingBalance);
    const openingSign = String(party.openingBalanceType || (isVendor ? 'CR' : 'DR')).toUpperCase() === (isVendor ? 'CR' : 'DR') ? 1 : -1;
    return [
      ...(opening ? [{ id: 'opening', date: party.createdAt || '', number: '—', type: 'Opening balance', change: opening * openingSign }] : []),
      ...from(isVendor ? 'bills' : 'invoices', isVendor ? 'Bill' : 'Invoice', 1, (row) => row.total),
      ...from('payments', isVendor ? 'Payment' : 'Receipt', -1, (row) => row.amount || row.total),
      ...from(isVendor ? 'debitNotes' : 'creditNotes', isVendor ? 'Debit note' : 'Credit note', -1, (row) => row.total || row.amount),
    ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [db, currentCompany?.id, partyId, party, isVendor]);
  if (!party) return null;
  const balance = rows.reduce((total, row) => total + row.change, 0);
  const charges = rows.filter((row) => row.change > 0).reduce((total, row) => total + row.change, 0);
  const settlements = -rows.filter((row) => row.change < 0).reduce((total, row) => total + row.change, 0);
  return <>
    <button type="button" className="ui-btn ui-btn-secondary shrink-0 !px-2" title={`View ${name} balance and transactions`} aria-label={`View ${name} balance and transactions`} onClick={() => setOpen(true)}><Activity size={16} aria-hidden="true" /></button>
    <Drawer open={open} onClose={() => setOpen(false)} title={`${isVendor ? 'Vendor' : 'Customer'} balance`} description={name}>
      <div className="space-y-6 p-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border p-3 ui-border-c"><div className="ui-caption">{isVendor ? 'Bills' : 'Invoiced'}</div><div className="mt-1 ui-money">{formatMoney(charges, currentCompany)}</div></div>
          <div className="rounded-lg border p-3 ui-border-c"><div className="ui-caption">{isVendor ? 'Paid / adjusted' : 'Received / adjusted'}</div><div className="mt-1 ui-money">{formatMoney(settlements, currentCompany)}</div></div>
          <div className="rounded-lg border p-3 ui-border-c"><div className="ui-caption">Balance</div><div className="mt-1 ui-money">{formatMoney(balance, currentCompany)}</div></div>
        </div>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Transactions</h3>
          <div className="divide-y ui-border-c">
            {rows.map((row) => <div key={row.id} className="flex items-center justify-between gap-3 py-2.5 text-sm"><div className="min-w-0"><div className="font-medium">{row.type} <span className="ui-muted">{row.number}</span></div><div className="ui-caption">{row.date ? formatDateIn(row.date, currentCompany) : '—'}</div></div><div className="shrink-0 text-right font-medium">{row.change < 0 ? '−' : '+'}{formatMoney(Math.abs(row.change), currentCompany)}</div></div>)}
            {!rows.length && <div className="py-8 text-center text-sm ui-muted">No transactions for this {kind}.</div>}
          </div>
        </section>
      </div>
    </Drawer>
  </>;
}
