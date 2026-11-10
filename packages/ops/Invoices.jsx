import React, { useCallback, useEffect, useState } from 'react';

import { notify } from '@ui/components/ui/notify';
import { GST_STATE_BY_CODE } from '@ui/utils/gst';
import { PageHead, WsDrawer } from '../../apps/admin/src/screens/wsKit';
import { InvoiceDocument, InvoiceStatus } from '../../apps/admin/src/screens/InvoiceDocument';
import {
  opsDiscardInvoice,
  opsInvoice,
  opsInvoiceStart,
  opsInvoices,
  opsIssueInvoice,
  opsMarkInvoicePaid,
  opsNewInvoice,
  opsPaymentAccounts,
  opsSaveInvoice,
  opsSendInvoiceToBooks,
  opsVoidInvoice,
} from './api';
import { Empty, Err, Loading, ReasonDrawer, Tabs, day, may, when } from './kit';
import { inr, rupeesText, toPaise } from './money';

/**
 * Invoices (server: routes/opsInvoices.ts, billing/invoices.ts): CLOR's
 * invoices to its customers, roadmap item 8. A draft is made for a customer
 * account, from the apps its subscription carries; issuing gives it the next
 * number of the year's series and freezes it; the customer then sees it in
 * Workspace with a UPI QR and CLOR's bank account. Mark paid takes the UTR
 * and moves the subscription on. Each issued invoice can go to CLOR's own
 * Books as a draft (the CLOR Books connector, item 10).
 */
const STATES = Object.entries(GST_STATE_BY_CODE)
  .filter(([, n]) => !/\(Old\)/.test(n))
  .sort((a, b) => a[1].localeCompare(b[1]));
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const FILTERS = [
  ['all', 'All'],
  ['DRAFT', 'Drafts'],
  ['ISSUED', 'Unpaid'],
  ['OVERDUE', 'Overdue'],
  ['PAID', 'Paid'],
  ['VOID', 'Cancelled'],
];
const BOOKS_WORD = { SENT: 'In Books', FAILED: 'Not sent: retry', NOT_SENT: '—' };

function Field({ id, label, hint, children }) {
  return (
    <div className="grid gap-1 content-start">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <span className="ws-card-blurb">{hint}</span> : null}
    </div>
  );
}
const Problems = ({ list }) =>
  list?.length ? (
    <ul role="alert" className="text-sm grid gap-1" style={{ color: 'rgb(var(--ws-danger))' }}>
      {list.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  ) : null;

/* ------------------------------------------------------------------ list */
export function Invoices({ role, openInvoice, initialStatus = 'all' }) {
  const [status, setStatus] = useState(initialStatus);
  const [data, setData] = useState(null);
  const [pages, setPages] = useState([null]);
  const [error, setError] = useState('');
  const [making, setMaking] = useState(false);
  const before = pages[pages.length - 1];
  useEffect(() => {
    opsInvoices({ status: status === 'all' ? '' : status, before })
      .then((r) => (setData(r), setError('')))
      .catch((e) => setError(String(e?.message || e)));
  }, [status, before]);
  const mayChange = may(role, 'BILLING');
  const t = data?.totals || {};
  const unpaid = t.ISSUED;
  return (
    <>
      <PageHead
        crumbs={['Operator']}
        title="Invoices"
        meta={unpaid?.count ? `${unpaid.count} unpaid, ${inr(unpaid.amount)}${t.OVERDUE?.count ? `; ${t.OVERDUE.count} overdue` : ''}` : 'Nothing unpaid'}
        actions={
          mayChange ? (
            <button type="button" className="ws-btn ws-btn--primary" onClick={() => setMaking(true)}>
              New invoice
            </button>
          ) : null
        }
      />
      <Tabs
        label="Which invoices"
        tabs={FILTERS}
        value={status}
        onChange={(k) => {
          setData(null);
          setStatus(k);
          setPages([null]);
        }}
      />
      <Err>{error}</Err>
      {!data ? (
        error ? null : <Loading />
      ) : !data.invoices.length ? (
        <Empty>{status === 'all' ? 'No invoices yet. New invoice makes a draft for a customer from the apps they have.' : 'None here.'}</Empty>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Invoices</caption>
            <thead>
              <tr>
                <th>Number</th>
                <th>Customer</th>
                <th>Issued</th>
                <th>Due</th>
                <th className="ui-num" style={{ textAlign: 'right' }}>
                  Amount
                </th>
                <th>Status</th>
                <th>Books</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button type="button" className="ws-name-link" onClick={() => openInvoice(r.id)}>
                      {r.number || 'Draft'}
                    </button>
                  </td>
                  <td style={{ whiteSpace: 'normal' }}>{r.buyerName || r.account?.name || '—'}</td>
                  <td>{day(r.issueDate)}</td>
                  <td>{day(r.dueDate)}</td>
                  <td className="ui-num" style={{ textAlign: 'right' }}>
                    {inr(r.total)}
                  </td>
                  <td>
                    <InvoiceStatus status={r.status} overdue={r.overdue} />
                  </td>
                  <td className="ws-item-sub">{r.status === 'DRAFT' ? '—' : BOOKS_WORD[r.booksStatus] || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && (pages.length > 1 || data.hasMore) ? (
        <nav className="flex items-center gap-2" aria-label="Pages">
          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={pages.length === 1} onClick={() => (setData(null), setPages((p) => p.slice(0, -1)))}>
            Previous
          </button>
          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={!data.hasMore} onClick={() => (setData(null), setPages((p) => [...p, data.invoices[data.invoices.length - 1].createdAt]))}>
            Next
          </button>
        </nav>
      ) : null}
      {making ? <InvoiceForm onClose={() => setMaking(false)} onSaved={(inv) => (setMaking(false), openInvoice(inv.id))} /> : null}
    </>
  );
}

/* ----------------------------------------------------- new or edited draft */
const blankLine = () => ({ description: '', quantity: '1', price: '' });
const linesIn = (lines = []) => lines.map((l) => ({ description: l.description, appCode: l.appCode || null, quantity: String(l.quantity), price: rupeesText(l.unitAmount) }));
const buyerIn = (b = {}) => {
  const code = b.stateCode || Object.entries(GST_STATE_BY_CODE).find(([, n]) => n === b.state)?.[0] || '';
  return { name: b.name || '', gstin: b.gstin || '', state: code, address: b.address || '', email: b.email || '' };
};

export function InvoiceForm({ invoice = null, onClose, onSaved }) {
  const [search, setSearch] = useState('');
  const [found, setFound] = useState([]);
  const [account, setAccount] = useState(invoice ? invoice.account || { id: invoice.accountId, name: invoice.buyer?.name } : null);
  const [lines, setLines] = useState(invoice ? linesIn(invoice.lines) : []);
  const [buyer, setBuyer] = useState(invoice ? buyerIn(invoice.buyer) : buyerIn());
  const [f, setF] = useState({ periodStart: invoice?.periodStart || '', periodEnd: invoice?.periodEnd || '', months: String(invoice?.months || 1), note: invoice?.note || '' });
  const [gstOn, setGstOn] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);

  useEffect(() => {
    if (account) return undefined;
    let live = true;
    const t = setTimeout(() => {
      opsPaymentAccounts(search.trim())
        .then((r) => live && setFound(r.accounts))
        .catch(() => {});
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [search, account]);

  const choose = async (a) => {
    setAccount(a);
    setProblems([]);
    try {
      const s = await opsInvoiceStart(a.id);
      setBuyer(buyerIn(s.buyer));
      setLines(s.lines.length ? linesIn(s.lines) : [blankLine()]);
      setGstOn(s.gstRegistered);
    } catch (e) {
      setProblems([String(e?.message || e)]);
    }
  };
  const setLine = (i, k) => (e) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l)));
  const setB = (k) => (e) => setBuyer((b) => ({ ...b, [k]: k === 'gstin' ? e.target.value.toUpperCase() : e.target.value }));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const amounts = lines.map((l) => {
    const p = toPaise(l.price);
    const q = Number(l.quantity);
    return p != null && Number.isInteger(q) && q > 0 ? p * q : null;
  });
  const subtotal = amounts.reduce((s, a) => s + (a || 0), 0);

  const save = async () => {
    setProblems([]);
    if (!account) return setProblems(['Choose the customer account.']);
    const bad = lines.findIndex((l) => toPaise(l.price) == null);
    if (bad >= 0) return setProblems([`Line ${bad + 1}: enter the price in rupees.`]);
    const body = {
      lines: lines.map((l) => ({ description: l.description.trim(), appCode: l.appCode || null, quantity: Number(l.quantity), unitAmount: toPaise(l.price) })),
      buyer: { name: buyer.name.trim() || null, gstin: buyer.gstin.trim() || null, state: buyer.state ? GST_STATE_BY_CODE[buyer.state] : null, address: buyer.address.trim() || null, email: buyer.email.trim() || null },
      periodStart: f.periodStart || null,
      periodEnd: f.periodEnd || null,
      months: Number(f.months),
      note: f.note.trim() || null,
    };
    setBusy(true);
    try {
      const r = invoice ? await opsSaveInvoice(invoice.id, body) : await opsNewInvoice({ ...body, accountId: account.id });
      notify.success(invoice ? 'Draft saved.' : 'Draft made. Check it, then issue it.');
      onSaved(r);
    } catch (e) {
      setProblems(e?.data?.problems?.length ? e.data.problems : [String(e?.message || e)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <WsDrawer
      open
      onClose={onClose}
      widthClass="w-[min(48rem,96vw)]"
      title={invoice ? 'Change the draft' : 'New invoice'}
      description="A draft first: nothing is numbered or shown to the customer until you issue it."
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ws-btn ws-btn--primary" disabled={busy || !account} onClick={save}>
            {busy ? 'Saving…' : 'Save draft'}
          </button>
        </>
      }
    >
      <div className="grid gap-6">
        {account ? (
          <div className="grid gap-1">
            <span className="text-sm font-medium">Customer account</span>
            <div className="flex items-center gap-3">
              <span>{account.name}</span>
              {invoice ? null : (
                <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => (setAccount(null), setLines([]))}>
                  Change
                </button>
              )}
            </div>
          </div>
        ) : (
          <Field id="inv-search" label="Customer account" hint="Type the account’s name or client ID.">
            <input id="inv-search" className="ui-input" autoComplete="off" value={search} onChange={(e) => setSearch(e.target.value)} />
            {found.length ? (
              <ul className="grid gap-1" aria-label="Matching accounts">
                {found.map((a) => (
                  <li key={a.id}>
                    <button type="button" className="ws-name-link" onClick={() => choose(a)}>
                      {a.name}
                    </button>
                    {a.code ? <span className="ws-item-sub ui-mono"> {a.code}</span> : null}
                  </li>
                ))}
              </ul>
            ) : search.trim() ? (
              <span className="ws-item-sub">No account matches.</span>
            ) : null}
          </Field>
        )}

        {account ? (
          <>
            <fieldset className="grid gap-3">
              <legend className="text-sm font-medium mb-2">Lines</legend>
              {lines.map((l, i) => (
                <div key={i} className="grid gap-2 items-end" style={{ gridTemplateColumns: 'minmax(10rem, 1fr) 5rem 8rem 7rem auto' }}>
                  <Field id={`inv-l${i}-d`} label={i === 0 ? 'What it is for' : <span className="sr-only">What line {i + 1} is for</span>}>
                    <input id={`inv-l${i}-d`} className="ui-input" value={l.description} onChange={setLine(i, 'description')} placeholder="CLOR People, 25 users" />
                  </Field>
                  <Field id={`inv-l${i}-q`} label={i === 0 ? 'Qty' : <span className="sr-only">Quantity, line {i + 1}</span>}>
                    <input id={`inv-l${i}-q`} className="ui-input ui-num" inputMode="numeric" value={l.quantity} onChange={setLine(i, 'quantity')} />
                  </Field>
                  <Field id={`inv-l${i}-p`} label={i === 0 ? 'Price, ₹' : <span className="sr-only">Price, line {i + 1}</span>}>
                    <input id={`inv-l${i}-p`} className="ui-input ui-num" inputMode="decimal" value={l.price} onChange={setLine(i, 'price')} />
                  </Field>
                  <span className="ui-num" style={{ textAlign: 'right', paddingBottom: 10 }}>
                    {amounts[i] == null ? '—' : inr(amounts[i])}
                  </span>
                  <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3">
                <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setLines((ls) => [...ls, blankLine()])}>
                  Add a line
                </button>
                <span className="ui-num">
                  Before tax <strong>{inr(subtotal)}</strong>
                </span>
              </div>
              <span className="ws-card-blurb">{gstOn === false ? 'No GST is added: CLOR is not registered yet (Money, Tax).' : 'GST is added when the draft is saved, by CLOR’s registration and the customer’s state.'}</span>
            </fieldset>

            <fieldset className="grid gap-3">
              <legend className="text-sm font-medium mb-2">Bill to</legend>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}>
                <Field id="inv-b-name" label="Name on the invoice">
                  <input id="inv-b-name" className="ui-input" value={buyer.name} onChange={setB('name')} />
                </Field>
                <Field id="inv-b-gstin" label="GSTIN (optional)">
                  <input id="inv-b-gstin" className="ui-input ui-mono" spellCheck={false} value={buyer.gstin} onChange={setB('gstin')} />
                </Field>
                <Field id="inv-b-state" label="State" hint="Decides CGST and SGST, or IGST.">
                  <select id="inv-b-state" className="ui-input" value={buyer.state} onChange={setB('state')}>
                    <option value="">Choose</option>
                    {STATES.map(([c, n]) => (
                      <option key={c} value={c}>
                        {n}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="inv-b-email" label="Email">
                  <input id="inv-b-email" className="ui-input" type="email" value={buyer.email} onChange={setB('email')} />
                </Field>
              </div>
              <Field id="inv-b-address" label="Address">
                <textarea id="inv-b-address" className="ui-input" rows={2} value={buyer.address} onChange={setB('address')} />
              </Field>
            </fieldset>

            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))' }}>
              <Field id="inv-from" label="Period from (optional)">
                <input id="inv-from" className="ui-input" type="date" value={f.periodStart} onChange={set('periodStart')} />
              </Field>
              <Field id="inv-to" label="Period to (optional)">
                <input id="inv-to" className="ui-input" type="date" value={f.periodEnd} onChange={set('periodEnd')} />
              </Field>
              <Field id="inv-months" label="When paid, it pays for">
                <select id="inv-months" className="ui-input" value={f.months} onChange={set('months')}>
                  {[1, 3, 6, 12, 24].map((m) => (
                    <option key={m} value={m}>
                      {m === 1 ? '1 month' : `${m} months`}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field id="inv-note" label="Note on the invoice (optional)">
              <textarea id="inv-note" className="ui-input" rows={2} value={f.note} onChange={set('note')} />
            </Field>
          </>
        ) : null}
        <p className="ws-card-blurb">Saving asks for a code from your authenticator app.</p>
        <Problems list={problems} />
      </div>
    </WsDrawer>
  );
}

/* --------------------------------------------------------- one invoice */
export function InvoicePage({ id, role, back, openCustomer }) {
  const [inv, setInv] = useState(null);
  const [error, setError] = useState('');
  const [doing, setDoing] = useState(null);
  const load = useCallback(() => {
    opsInvoice(id)
      .then((r) => (setInv(r), setError('')))
      .catch((e) => setError(String(e?.message || e)));
  }, [id]);
  useEffect(load, [load]);
  if (!inv) return error ? <Err>{error}</Err> : <Loading />;
  const mayChange = may(role, 'BILLING');
  const done = (r, message) => {
    if (r) setInv(r);
    setDoing(null);
    if (message) notify.success(message);
  };
  const toBooks = async () => {
    setDoing('books');
    try {
      const r = await opsSendInvoiceToBooks(inv.id);
      setInv(r);
      if (r.books?.ok) notify.success(r.books.message);
      else notify.error(r.books?.message || 'Not sent.');
    } catch (e) {
      notify.error(String(e?.message || e));
    } finally {
      setDoing(null);
    }
  };

  const primary = !mayChange
    ? null
    : inv.status === 'DRAFT'
      ? ['issue', 'Issue invoice']
      : inv.status === 'ISSUED'
        ? ['paid', 'Mark paid']
        : null;
  return (
    <>
      <PageHead
        crumbs={['Operator', 'Invoices']}
        title={inv.number || 'Draft invoice'}
        meta={
          <span className="flex items-center gap-2 flex-wrap">
            <InvoiceStatus status={inv.status} overdue={inv.overdue} />
            <span>
              {inv.account ? (
                <button type="button" className="ws-name-link" onClick={() => openCustomer(inv.account.id)}>
                  {inv.account.name}
                </button>
              ) : null}{' '}
              · {inr(inv.total)}
            </span>
          </span>
        }
        actions={
          <>
            <button type="button" className="ws-btn ws-btn--quiet" onClick={back}>
              All invoices
            </button>
            {primary ? (
              <button type="button" className="ws-btn ws-btn--primary" onClick={() => setDoing(primary[0])}>
                {primary[1]}
              </button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6" style={{ gridTemplateColumns: 'minmax(0, 1fr)', maxWidth: 960 }}>
        {mayChange && inv.status !== 'VOID' ? (
          <div className="flex flex-wrap gap-2">
            {inv.status === 'DRAFT' ? (
              <>
                <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setDoing('edit')}>
                  Change the draft
                </button>
                <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setDoing('discard')}>
                  Discard the draft
                </button>
              </>
            ) : null}
            {inv.status === 'ISSUED' ? (
              <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setDoing('void')}>
                Cancel the invoice
              </button>
            ) : null}
            {inv.status === 'ISSUED' || inv.status === 'PAID' ? (
              <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={doing === 'books'} onClick={toBooks}>
                {doing === 'books' ? 'Sending…' : inv.booksStatus === 'SENT' ? 'Send to Books again' : inv.booksStatus === 'FAILED' ? 'Retry sending to Books' : 'Send to Books'}
              </button>
            ) : null}
          </div>
        ) : null}

        {inv.status === 'DRAFT' && !inv.payTo ? <p className="ws-notice">No way to pay is set up yet, so the invoice will show no UPI QR or bank account. Set them in Money, Payments, Manual: UPI and bank transfer.</p> : null}
        {inv.status !== 'DRAFT' && inv.booksStatus !== 'NOT_SENT' ? (
          <p className="ws-notice">
            {inv.booksStatus === 'SENT' ? `In CLOR Books as a draft since ${when(inv.booksSentAt)}. A CA checks it there and saves it.` : `Not sent to Books: ${inv.booksError || 'it failed'}. Tried ${inv.booksAttempts} ${inv.booksAttempts === 1 ? 'time' : 'times'}.`}
          </p>
        ) : null}

        <InvoiceDocument invoice={inv} />
      </div>

      {doing === 'edit' ? <InvoiceForm invoice={inv} onClose={() => setDoing(null)} onSaved={(r) => done(r)} /> : null}
      <ReasonDrawer
        open={doing === 'issue'}
        title="Issue this invoice"
        what={`It gets the next number of this year’s series and today’s date, and nothing on it can change after. ${inv.account?.name || 'The customer'} sees it in Workspace, Billing, with how to pay ${inr(inv.total)}.`}
        confirmLabel="Issue invoice"
        reasonOptional
        onClose={() => setDoing(null)}
        onConfirm={async () => {
          const r = await opsIssueInvoice(inv.id);
          done(r, `Issued as ${r.number}.${r.books?.ok ? ' Sent to Books.' : ''}`);
        }}
      />
      <ReasonDrawer
        open={doing === 'discard'}
        title="Discard this draft"
        what="The draft is deleted. It never had a number, so the series has no gap."
        confirmLabel="Discard draft"
        tone="danger"
        reasonOptional
        onClose={() => setDoing(null)}
        onConfirm={async () => {
          await opsDiscardInvoice(inv.id);
          notify.success('Draft discarded.');
          back();
        }}
      />
      <ReasonDrawer
        open={doing === 'void'}
        title="Cancel this invoice"
        what={`${inv.number} stays in the series, marked cancelled, and the customer sees nothing is due on it. A paid invoice cannot be cancelled.`}
        confirmLabel="Cancel invoice"
        tone="danger"
        onClose={() => setDoing(null)}
        onConfirm={async (reason) => done(await opsVoidInvoice(inv.id, reason), `${inv.number} is cancelled.`)}
      />
      {doing === 'paid' ? <MarkPaid inv={inv} onClose={() => setDoing(null)} onDone={(r) => done(r, r.paidUntil ? `Paid. ${inv.account?.name || 'The account'} is paid until ${day(r.paidUntil)}.` : 'Paid.')} /> : null}
    </>
  );
}

function MarkPaid({ inv, onClose, onDone }) {
  const [f, setF] = useState({ reference: '', paidOn: today(), amount: rupeesText(inv.total) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const amount = toPaise(f.amount);
  const save = async () => {
    setError('');
    if (!amount) return setError('Enter the amount received, in rupees.');
    setBusy(true);
    try {
      onDone(await opsMarkInvoicePaid(inv.id, { reference: f.reference.trim(), paidOn: f.paidOn, amount }));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <WsDrawer
      open
      onClose={onClose}
      title={`Mark ${inv.number} paid`}
      description={`A UPI or bank transfer that reached CLOR’s account. The subscription becomes active for ${inv.months === 1 ? '1 month' : `${inv.months} months`}, and the payment goes in the Payments log.`}
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ws-btn ws-btn--primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Mark paid'}
          </button>
        </>
      }
    >
      <div className="grid gap-5">
        <Field id="paid-ref" label="UTR or bank reference" hint="The 12-digit UTR from the UPI app or the bank statement. The same reference cannot be used twice.">
          <input id="paid-ref" className="ui-input" autoComplete="off" spellCheck={false} value={f.reference} onChange={set('reference')} />
        </Field>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))' }}>
          <Field id="paid-on" label="Money arrived on">
            <input id="paid-on" className="ui-input" type="date" max={today()} value={f.paidOn} onChange={set('paidOn')} />
          </Field>
          <Field id="paid-amount" label="Amount received, ₹" hint={amount && amount !== inv.total ? `The invoice is for ${inr(inv.total)}.` : null}>
            <input id="paid-amount" className="ui-input ui-num" inputMode="decimal" value={f.amount} onChange={set('amount')} />
          </Field>
        </div>
        <p className="ws-card-blurb">Saving asks for a code from your authenticator app. It goes on the operator log.</p>
        <Err>{error}</Err>
      </div>
    </WsDrawer>
  );
}
