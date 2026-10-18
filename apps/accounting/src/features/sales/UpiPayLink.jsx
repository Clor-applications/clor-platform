import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, MessageCircle, RefreshCw } from 'lucide-react';

import { notify } from '@ui/components/ui/notify';
import { getInvoicePaymentDetails } from '@ui/utils/invoicePrefs';
import { cancelPayRequest, confirmPayRequest, createPayment, createPayRequest, listPaymentModes, listPayRequests } from '@ui/api/payments';

/**
 * UPI Direct for one invoice: a link the customer opens to pay straight into
 * the company's UPI ID — no gateway, no fee. They pay in their UPI app and
 * give the UTR; once the money is in the bank, Confirm records the receipt
 * against the invoice (the usual receipt, in the chosen bank account) and
 * closes the link.
 */
const STATUS = { PENDING: ['Waiting for payment', 'ui-pill-warn'], CLAIMED: ['Customer says paid', 'ui-pill-warn'], PAID: ['Paid', 'ui-pill-pos'], CANCELLED: ['Cancelled', 'ui-pill-neutral'], EXPIRED: ['Expired', 'ui-pill-neutral'] };

export default function UpiPayLink({ invoice, currentCompany, onPaid }) {
  /* The invoice as the server knows it: the browser's own list keys invoices differently. */
  const serverId = String(invoice?.backendInvoiceId || '').trim();
  const payment = getInvoicePaymentDetails(currentCompany);
  const [vpa, setVpa] = useState(payment.upiId || '');
  const [payee, setPayee] = useState(payment.payeeName || currentCompany?.name || '');
  const [rows, setRows] = useState(null);
  const [made, setMade] = useState(null);
  const [modes, setModes] = useState([]);
  const [modeId, setModeId] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => (serverId ? listPayRequests(serverId).then(setRows).catch(() => setRows([])) : Promise.resolve(setRows([]))), [serverId]);
  useEffect(() => {
    load();
    listPaymentModes()
      .then((m) => {
        const banks = m.filter((x) => String(x.controlKind || x.kind || '').toUpperCase() !== 'CASH');
        setModes(banks.length ? banks : m);
        setModeId((banks[0] || m[0])?.id || '');
      })
      .catch(() => setModes([]));
  }, [load]);

  const act = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      notify.error(String(err?.message || 'Not done.'));
    } finally {
      setBusy('');
    }
  };
  const make = () =>
    act('make', async () => {
      const r = await createPayRequest({ docId: serverId, payeeVpa: vpa.trim(), payeeName: payee.trim() });
      setMade(r);
      load();
    });
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      notify.success('Copied.');
    } catch {
      notify.error('Could not copy — select it and copy by hand.');
    }
  };
  const confirm = (r) =>
    act(`confirm:${r.id}`, async () => {
      if (!modeId) throw new Error('Choose the bank account the money arrived in.');
      const receipt = await createPayment({
        direction: 'RECEIPT',
        date: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
        partyType: 'CUSTOMER',
        partyName: invoice.customerName || r.partyName || null,
        ledgerAccountId: modeId,
        amount: r.amount,
        instrumentRef: `UPI ${r.payerUtr || r.reference}`.slice(0, 100),
        notes: `UPI Direct ${r.reference}`,
        allocations: [{ docType: 'INVOICE', docId: serverId, amount: r.amount }],
      });
      const paymentId = receipt?.payment?.id || receipt?.id;
      await confirmPayRequest(r.id, paymentId);
      notify.success('Receipt recorded and the link closed.');
      load();
      onPaid?.();
    });
  const cancel = (r) => act(`cancel:${r.id}`, async () => { await cancelPayRequest(r.id); load(); });

  const share = made ? `Please pay ₹${made.request.amount.toFixed(2)} for invoice ${invoice.number} here: ${made.url}` : '';
  const open = (rows || []).filter((r) => r.status === 'PENDING' || r.status === 'CLAIMED');

  if (!serverId) return <p className="ui-caption">This invoice was made before invoices were kept on the server, so it cannot have a pay link. Share your UPI ID or the QR on the printed invoice instead.</p>;

  return (
    <div className="space-y-4">
      <p className="ui-caption">Your customer pays straight into your UPI ID from any UPI app — no gateway and no fee. They enter the UTR after paying; you confirm when the money shows in the bank.</p>

      {made ? (
        <div className="ui-card space-y-2 p-3">
          <div className="ui-label">Link for {invoice.customerName || 'the customer'}</div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="ui-mono min-w-0 flex-1 break-all text-sm">{made.url}</code>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => copy(made.url)}><Copy size={14} aria-hidden="true" /> Copy</button>
            <a className="ui-btn ui-btn-secondary ui-btn-sm" href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noreferrer"><MessageCircle size={14} aria-hidden="true" /> WhatsApp</a>
          </div>
          <div className="ui-caption">Reference {made.request.reference} · ₹{made.request.amount.toFixed(2)} to {made.request.payeeVpa}</div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="ui-label">Your UPI ID</span><input className="ui-input w-full ui-mono" value={vpa} onChange={(e) => setVpa(e.target.value)} placeholder="business@okhdfcbank" /></label>
          <label className="block"><span className="ui-label">Name shown to the payer</span><input className="ui-input w-full" value={payee} onChange={(e) => setPayee(e.target.value)} /></label>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
            <button type="button" className="ui-btn ui-btn-primary" disabled={busy === 'make' || !vpa.includes('@') || !payee.trim()} onClick={make}>{busy === 'make' ? 'Making…' : 'Make a pay link'}</button>
            <span className="ui-caption">For what is still owed. A new link replaces an unpaid one.</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="ui-t-sec">Links for this invoice</span>
        <button type="button" className="ui-icon-btn" aria-label="Refresh" onClick={load}><RefreshCw size={14} /></button>
      </div>
      {rows === null ? <p className="ui-caption">Loading…</p> : rows.length ? (
        <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
          {rows.map((r) => {
            const [label, pill] = STATUS[r.status] || [r.status, 'ui-pill-neutral'];
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  ₹{r.amount.toFixed(2)} · {r.reference}
                  {r.payerUtr ? <> · UTR <code className="ui-mono">{r.payerUtr}</code></> : null}
                  {r.payerName ? ` · ${r.payerName}` : ''}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className={`ui-pill ${pill}`}>{label}</span>
                  {r.status === 'CLAIMED' ? (
                    <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={busy === `confirm:${r.id}`} onClick={() => confirm(r)}><Check size={14} aria-hidden="true" /> Money is in — record receipt</button>
                  ) : null}
                  {r.status === 'PENDING' || r.status === 'CLAIMED' ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => cancel(r)}>Cancel</button> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : <p className="ui-caption">None yet.</p>}

      {open.some((r) => r.status === 'CLAIMED') ? (
        <label className="block">
          <span className="ui-label">Record the receipt in</span>
          <select className="ui-select w-full" value={modeId} onChange={(e) => setModeId(e.target.value)}>
            {modes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <span className="ui-caption">Check your bank first: the UTR is the customer's word until the money shows.</span>
        </label>
      ) : null}
    </div>
  );
}
