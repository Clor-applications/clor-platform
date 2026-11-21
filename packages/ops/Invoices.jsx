import React, { useCallback, useEffect, useRef, useState } from 'react';

import { confirmDialog, notify } from '@ui/components/ui/notify';
import { GST_STATE_BY_CODE } from '@ui/utils/gst';
import { PageHead, WsDrawer } from '../../apps/admin/src/screens/wsKit';
import { InvoiceDocument, InvoiceStatus } from '../../apps/admin/src/screens/InvoiceDocument';
import {
  opsDiscardInvoice,
  opsInvoice,
  opsInvoiceReminders,
  opsInvoiceSends,
  opsInvoiceStart,
  opsInvoices,
  opsIssueInvoice,
  opsMarkInvoicePaid,
  opsNewInvoice,
  opsPaymentAccounts,
  opsRemindInvoice,
  opsSaveInvoice,
  opsSendInvoiceAgain,
  opsSendInvoiceToBooks,
  opsTdsCertificate,
  opsVoidInvoice,
} from './api';
import { Empty, Err, ErrorSummary, FieldMsg, HoldOpen, Loading, ReasonDrawer, Tabs, day, fieldErr, may, when, errorWords } from './kit';
import { inr, rupeesText, toPaise } from './money';
import { Button } from '@ui/components/ui/Primitives';
import { SelectField } from '@ui/components/ui/SelectField';

/**
 * Invoices (server: routes/opsInvoices.ts, billing/invoices.ts): CLOR's
 * invoices to its customers, roadmap item 8. A draft is made for a customer
 * account, from the apps its subscription carries; issuing gives it the next
 * number of the year's series and freezes it; the customer then sees it in
 * Workspace with a UPI QR and CLOR's bank account. Mark paid takes the UTR
 * and moves the subscription on. Each issued invoice can go to CLOR's own
 * Books as a draft (the CLOR Books connector, item 10).
 *
 * An invoice is emailed to the customer when it is issued (staff choose),
 * again by hand, and as a reminder to pay (server: billing/invoiceEmail.ts).
 * Every email is listed under the document.
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
const times = (n) => (n === 1 ? 'once' : `${n} times`);
/** Whole days past the due date, by the Indian calendar; 0 when not late. */
export const daysLate = (dueDate, now = Date.now()) => {
  if (!dueDate) return 0;
  const istDay = (t) => Math.floor((new Date(t).getTime() + 330 * 60000) / 86400000);
  return Math.max(0, istDay(now) - istDay(dueDate));
};

/**
 * Ask, naming who gets it, then send. Shared by the invoice page and the
 * Overdue list so both say the same thing. Answers the server's reply, or
 * null when the person said no or it was refused (the refusal is shown).
 */
async function emailInvoice(inv, kind, to) {
  const reminder = kind === 'remind';
  const ok = await confirmDialog({
    title: reminder ? 'Send a reminder?' : 'Send the invoice again?',
    message: reminder ? `A reminder to pay ${inv.number} (${inr(inv.total)}) goes to ${to}.` : `${inv.number} goes to ${to} again, with how to pay ${inr(inv.total)}.`,
    confirmLabel: reminder ? 'Send reminder' : 'Send again',
    tone: 'primary',
  });
  if (!ok) return null;
  try {
    const r = await (reminder ? opsRemindInvoice : opsSendInvoiceAgain)(inv.id);
    if (r.emailed) notify.success(reminder ? `Reminder sent to ${r.emailedTo}.` : `Sent again to ${r.emailedTo}.`);
    else notify.error(`The email did not go: ${r.emailError || 'try again in a minute.'}`);
    return r;
  } catch (e) {
    notify.error(errorWords(e, 'send the email'));
    return null;
  }
}

function Field({ id, label, hint, children }) {
  return (
    <div className="grid gap-1 content-start">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint ? <span className="ws-card-blurb">{hint}</span> : null}
    </div>
  );
}
const monthsWord = (n) => (Number(n) === 1 ? '1 month' : `${n} months`);

/**
 * What marking an invoice paid will do, in words, for the last check before it goes:
 * the amount, the customer, the months it pays for, and a plain warning when the money is short.
 * A short amount still closes the invoice in full; the server takes it only with acceptShort, which this
 * confirmation sends (billing/invoices.ts markInvoicePaid).
 */
export function markPaidWords(inv, amount, tds = 0) {
  const who = inv.account?.name || inv.buyerName || inv.buyer?.name || 'the customer';
  const covered = amount + (tds || 0);
  const lines = [
    `${inr(amount)} from ${who}${tds ? `, with ${inr(tds)} TDS kept back` : ''}, against ${inv.number || 'this invoice'} for ${inr(inv.total)}.`,
    `The invoice closes as paid and the subscription is paid for ${monthsWord(inv.months || 1)} more.`,
  ];
  const short = inv.total - covered;
  if (short > 0) lines.push(`This is ${inr(short)} short of the invoice. It is still marked paid in full and nothing asks the customer for the rest, so only go on if CLOR agreed to take less.`);
  else if (short < 0) lines.push(`This is ${inr(-short)} more than the invoice. The extra is not kept as credit.`);
  return { short: Math.max(0, short), message: lines.join(' ') };
}

/* ------------------------------------------------------------------ list */
export function Invoices({ role, openInvoice, initialStatus = 'all' }) {
  const [status, setStatus] = useState(initialStatus);
  const [data, setData] = useState(null);
  const [pages, setPages] = useState([null]);
  const [error, setError] = useState('');
  const [making, setMaking] = useState(false);
  const [reminding, setReminding] = useState('');
  const [again, setAgain] = useState(0);
  /* Which list is on screen; while it is not the one asked for, the rows shown are dimmed. */
  const [shownKey, setShownKey] = useState('');
  const tableRef = useRef(null);
  const paged = useRef(false);
  const before = pages[pages.length - 1];
  const wantKey = `${status}|${before || ''}|${again}`;
  const loading = shownKey !== wantKey;
  useEffect(() => {
    let live = true;
    opsInvoices({ status: status === 'all' ? '' : status, before })
      .then((r) => {
        if (!live) return;
        setData(r);
        setError('');
        setShownKey(`${status}|${before || ''}|${again}`);
        /* Another page: the keyboard and the eye go to the top of the table, not left at the pager. */
        if (paged.current) {
          paged.current = false;
          requestAnimationFrame(() => tableRef.current?.focus());
        }
      })
      .catch((e) => {
        if (!live) return;
        setError(errorWords(e, 'load the invoices'));
        setShownKey(`${status}|${before || ''}|${again}`);
      });
    return () => {
      live = false;
    };
  }, [status, before, again]);
  /* The rows on screen stay while the next page is read, dimmed, so the page does not jump. */
  const turn = (next) => {
    paged.current = true;
    setPages(next);
  };
  const mayChange = may(role, 'BILLING');
  /* Chasing is the Overdue view's job, so only it shows how late each one is and when it was last reminded. */
  const chasing = status === 'OVERDUE';
  const remind = async (r) => {
    setReminding(r.id);
    const sent = await emailInvoice(r, 'remind', r.sentTo || r.buyerName || r.account?.name || 'the customer');
    setReminding('');
    if (sent) setAgain((n) => n + 1);
  };
  const t = data?.totals || {};
  const unpaid = t.ISSUED;
  return (
    <>
      <PageHead
        crumbs={['Billing and setup']}
        title="Invoices"
        counts={!data ? null : unpaid?.count ? `${unpaid.count} unpaid, ${inr(unpaid.amount)}${t.OVERDUE?.count ? ` · ${t.OVERDUE.count} overdue` : ''}` : 'Nothing unpaid'}
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
      <Err onRetry={() => setAgain((n) => n + 1)}>{error}</Err>
      {!data ? (
        error ? null : <Loading />
      ) : !data.invoices.length ? (
        <Empty>{status === 'all' ? 'No invoices yet. New invoice makes a draft for a customer from the apps they have.' : 'No invoices with this status.'}</Empty>
      ) : (
        <div className="ws-table-wrap" ref={tableRef} tabIndex={-1} aria-busy={loading || undefined} style={loading ? { opacity: 0.55, transition: 'opacity 120ms ease-out' } : { transition: 'opacity 120ms ease-out' }}>
          <table className="ws-table">
            <caption className="sr-only">{`Invoices${pages.length > 1 ? `, page ${pages.length}` : ''}`}</caption>
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
                {chasing ? (
                  <>
                    <th className="ui-num" style={{ textAlign: 'right' }}>
                      Days late
                    </th>
                    <th>Last reminded</th>
                  </>
                ) : null}
                <th>Books</th>
                {chasing && mayChange ? (
                  <th>
                    <span className="sr-only">Remind</span>
                  </th>
                ) : null}
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
                  {chasing ? (
                    <>
                      <td className="ui-num" style={{ textAlign: 'right' }}>
                        {daysLate(r.dueDate)}
                      </td>
                      <td style={{ whiteSpace: 'normal' }}>
                        {r.lastRemindedAt ? `${day(r.lastRemindedAt)}${r.reminderCount > 1 ? `, ${times(r.reminderCount)} in all` : ''}` : 'Never'}
                        {r.remindersOff ? <span className="ws-item-sub" style={{ display: 'block' }}>Automatic reminders stopped</span> : null}
                      </td>
                    </>
                  ) : null}
                  <td className="ws-item-sub">{r.status === 'DRAFT' ? '—' : BOOKS_WORD[r.booksStatus] || '—'}</td>
                  {chasing && mayChange ? (
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" aria-label={`Send reminder for ${r.number}`} disabled={reminding === r.id} onClick={() => remind(r)}>
                        Send reminder
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && (pages.length > 1 || data.hasMore) ? (
        <nav className="flex items-center gap-2" aria-label="Pages">
          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={loading || pages.length === 1} onClick={() => turn((p) => p.slice(0, -1))}>
            Previous
          </button>
          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={loading || !data.hasMore} onClick={() => turn((p) => [...p, data.invoices[data.invoices.length - 1].createdAt])}>
            Next
          </button>
          {loading ? <span className="ws-head-meta" role="status">Loading…</span> : null}
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
  const [problems, setProblems] = useState({});
  /* The account search: what was asked, whether an answer came, and whether it failed. */
  const [lookedFor, setLookedFor] = useState(null);
  const [lookError, setLookError] = useState('');
  const [lookAgain, setLookAgain] = useState(0);
  /* Unsaved: a new invoice once a customer is chosen or typed for; a draft once anything differs from it. */
  const [start] = useState(() => JSON.stringify({ lines, buyer, f }));
  const dirty = !busy && (invoice ? JSON.stringify({ lines, buyer, f }) !== start : Boolean(account || search.trim()));

  useEffect(() => {
    if (account) return undefined;
    let live = true;
    const asked = search.trim();
    const t = setTimeout(() => {
      opsPaymentAccounts(asked)
        .then((r) => {
          if (!live) return;
          setLookError('');
          setFound(r.accounts || []);
          setLookedFor(asked);
        })
        .catch((e) => live && setLookError(errorWords(e, 'look up the accounts')))
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [search, account, lookAgain]);

  const choose = async (a) => {
    setAccount(a);
    setProblems({});
    try {
      const s = await opsInvoiceStart(a.id);
      setBuyer(buyerIn(s.buyer));
      setLines(s.lines.length ? linesIn(s.lines) : [blankLine()]);
      setGstOn(s.gstRegistered);
    } catch (e) {
      setProblems({ server: errorWords(e, 'find the account') });
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
    /* Every problem at once, each on its field. */
    const found = {};
    if (!account) found.account = 'Choose the customer account.';
    lines.forEach((l, i) => {
      const q = Number(l.quantity);
      if (!Number.isInteger(q) || q <= 0) found[`l${i}-q`] = `Line ${i + 1}: the quantity is a whole number, 1 or more.`;
      if (toPaise(l.price) == null) found[`l${i}-p`] = `Line ${i + 1}: enter the price in rupees, like 1250 or 1250.50.`;
    });
    setProblems(found);
    if (Object.keys(found).length) return;
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
      const list = e?.data?.problems?.length ? e.data.problems : [errorWords(e, 'save the draft')];
      setProblems(Object.fromEntries(list.map((m, i) => [`server${i}`, m])));
    } finally {
      setBusy(false);
    }
  };

  return (
    <WsDrawer
      open
      onClose={() => !busy && onClose()}
      dirty={dirty || busy}
      widthClass="w-[min(48rem,96vw)]"
      title={invoice ? 'Change the draft' : 'New invoice'}
      description="A draft first: nothing is numbered or shown to the customer until you issue it."
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <Button plain className="ws-btn ws-btn--primary" loading={busy} disabled={!account} onClick={save}>
            Save draft
          </Button>
        </>
      }
    >
      <div className="grid gap-6">
        <HoldOpen active={busy} />
        <ErrorSummary errors={problems} />
        {account ? (
          <div className="grid gap-1">
            <span className="text-sm font-semibold">Customer account</span>
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
          <Field id="inv-search" label="Customer account" hint="Type the account’s name or account ID.">
            <input id="inv-search" className="ui-input" autoComplete="off" value={search} onChange={(e) => setSearch(e.target.value)} {...fieldErr(problems, 'account', 'inv')} />
            <FieldMsg errors={problems} k="account" idBase="inv" />
            {lookError ? (
              <Err onRetry={() => setLookAgain((n) => n + 1)}>{lookError}</Err>
            ) : lookedFor !== search.trim() && !found.length ? (
              search.trim() ? <span className="ws-item-sub" role="status">Looking…</span> : null
            ) : found.length ? (
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
              <span className="ws-item-sub" role="status">No account matches.</span>
            ) : null}
          </Field>
        )}

        {account ? (
          <>
            <fieldset className="grid gap-3">
              <legend className="text-sm font-semibold mb-2">Lines</legend>
              {lines.map((l, i) => (
                <div key={i} className="grid gap-2 items-end" style={{ gridTemplateColumns: 'minmax(10rem, 1fr) 5rem 8rem 7rem auto' }}>
                  <Field id={`inv-l${i}-d`} label={i === 0 ? 'What it is for' : <span className="sr-only">What line {i + 1} is for</span>}>
                    <input id={`inv-l${i}-d`} className="ui-input" value={l.description} onChange={setLine(i, 'description')} placeholder="CLOR People, 25 users" />
                  </Field>
                  <Field id={`inv-l${i}-q`} label={i === 0 ? 'Quantity' : <span className="sr-only">Quantity, line {i + 1}</span>}>
                    <input id={`inv-l${i}-q`} className="ui-input ui-num" inputMode="numeric" value={l.quantity} onChange={setLine(i, 'quantity')} {...fieldErr(problems, `l${i}-q`, 'inv')} />
                    <FieldMsg errors={problems} k={`l${i}-q`} idBase="inv" />
                  </Field>
                  <Field id={`inv-l${i}-p`} label={i === 0 ? 'Price, ₹' : <span className="sr-only">Price, line {i + 1}</span>}>
                    <input id={`inv-l${i}-p`} className="ui-input ui-num" inputMode="decimal" value={l.price} onChange={setLine(i, 'price')} {...fieldErr(problems, `l${i}-p`, 'inv')} />
                    <FieldMsg errors={problems} k={`l${i}-p`} idBase="inv" />
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
              <span className="ws-card-blurb">{gstOn === false ? 'No GST is added: CLOR is not registered yet (Billing and setup, Tax).' : 'GST is added when the draft is saved, by CLOR’s registration and the customer’s state.'}</span>
            </fieldset>

            <fieldset className="grid gap-3">
              <legend className="text-sm font-semibold mb-2">Bill to</legend>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}>
                <Field id="inv-b-name" label="Name on the invoice">
                  <input id="inv-b-name" className="ui-input" value={buyer.name} onChange={setB('name')} />
                </Field>
                <Field id="inv-b-gstin" label="GSTIN (optional)">
                  <input id="inv-b-gstin" className="ui-input ui-mono" spellCheck={false} value={buyer.gstin} onChange={setB('gstin')} />
                </Field>
                <Field id="inv-b-state" label="State" hint="Decides CGST and SGST, or IGST.">
                  <SelectField id="inv-b-state" className="ui-input" value={buyer.state} onChange={setB('state')}>
                    <option value="">Choose</option>
                    {STATES.map(([c, n]) => (
                      <option key={c} value={c}>
                        {n}
                      </option>
                    ))}
                  </SelectField>
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
      </div>
    </WsDrawer>
  );
}

/* --------------------------------------------------------- one invoice */
export function InvoicePage({ id, role, back, openCustomer }) {
  const [inv, setInv] = useState(null);
  const [error, setError] = useState('');
  const [doing, setDoing] = useState(null);
  const [emailIt, setEmailIt] = useState(true);
  const [sends, setSends] = useState(null);
  const load = useCallback(() => {
    opsInvoice(id)
      .then((r) => (setInv(r), setError('')))
      .catch((e) => setError(errorWords(e, 'load the invoice')));
  }, [id]);
  useEffect(load, [load]);
  const loadSends = useCallback(() => {
    opsInvoiceSends(id)
      .then((r) => setSends(r?.sends || []))
      .catch(() => setSends([]));
  }, [id]);
  /* A draft has never been emailed, so its list is not asked for. */
  const numbered = Boolean(inv && inv.status !== 'DRAFT');
  useEffect(() => {
    if (numbered) loadSends();
  }, [numbered, loadSends]);
  if (!inv) return error ? <Err onRetry={load}>{error}</Err> : <Loading />;
  const mayChange = may(role, 'BILLING');
  const mayEmail = mayChange && inv.status === 'ISSUED' && Boolean(inv.emailTo);
  const email = async (kind) => {
    setDoing(kind);
    const r = await emailInvoice(inv, kind, inv.emailTo);
    setDoing(null);
    if (!r) return;
    setInv(r);
    loadSends();
  };
  const setReminders = async (off) => {
    setDoing('reminders');
    try {
      setInv(await opsInvoiceReminders(inv.id, off));
      notify.success(off ? 'Automatic reminders are stopped for this invoice. Send reminder still works.' : 'Automatic reminders are allowed again for this invoice.');
    } catch (e) {
      notify.error(errorWords(e, 'change the reminders'));
    } finally {
      setDoing(null);
    }
  };
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
      else notify.error(r.books?.message || 'The invoice did not reach Books. Check the connector under Invoice settings, then send it again.');
    } catch (e) {
      notify.error(errorWords(e, 'send the invoice to Books'));
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
        crumbs={['Billing and setup', 'Invoices']}
        title={inv.number || 'Draft invoice'}
        counts={
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
              <button type="button" className="ws-btn ws-btn--primary" onClick={() => (setEmailIt(true), setDoing(primary[0]))}>
                {primary[1]}
              </button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6" style={{ gridTemplateColumns: 'minmax(0, 1fr)', maxWidth: 960 }}>
        {numbered ? (
          <p className="ws-item-sub" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px' }}>
            <span>{inv.sentTo ? `Emailed to ${inv.sentTo} on ${day(inv.lastSentAt)}` : 'Not emailed yet'}</span>
            {inv.reminderCount ? (
              <span>
                Reminded {times(inv.reminderCount)}, last on {day(inv.lastRemindedAt)}
              </span>
            ) : null}
            {inv.status === 'ISSUED' && inv.remindersOff ? <span>Automatic reminders are stopped for this invoice</span> : null}
            {mayChange && inv.status === 'ISSUED' ? (
              <button type="button" className="ws-link" disabled={doing === 'reminders'} onClick={() => setReminders(!inv.remindersOff)}>
                {inv.remindersOff ? 'Allow automatic reminders again' : 'Stop automatic reminders for this invoice'}
              </button>
            ) : null}
          </p>
        ) : null}
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
            {mayEmail ? (
              <>
                <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={doing === 'send'} onClick={() => email('send')}>
                  Send again
                </button>
                <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={doing === 'remind'} onClick={() => email('remind')}>
                  Send reminder
                </button>
              </>
            ) : null}
            {inv.status === 'ISSUED' ? (
              <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setDoing('void')}>
                Cancel the invoice
              </button>
            ) : null}
            {inv.status === 'ISSUED' || inv.status === 'PAID' ? (
              <Button plain className="ws-btn ws-btn--quiet ws-btn--small" loading={doing === 'books'} onClick={toBooks}>
                {inv.booksStatus === 'SENT' ? 'Send to Books again' : inv.booksStatus === 'FAILED' ? 'Retry sending to Books' : 'Send to Books'}
              </Button>
            ) : null}
          </div>
        ) : null}

        {inv.status === 'DRAFT' && !inv.payTo ? <p className="ws-notice">No way to pay is set up yet, so the invoice will show no UPI QR or bank account. Set them in Billing and setup, Payments, Manual: UPI and bank transfer.</p> : null}
        {inv.status !== 'DRAFT' && inv.booksStatus !== 'NOT_SENT' ? (
          <p className="ws-notice">
            {inv.booksStatus === 'SENT' ? `In CLOR Books as a draft since ${when(inv.booksSentAt)}. A CA checks it there and saves it.` : `Not sent to Books: ${inv.booksError || 'it failed'}. Tried ${inv.booksAttempts} ${inv.booksAttempts === 1 ? 'time' : 'times'}.`}
          </p>
        ) : null}

        {inv.tdsDeducted ? (
          <p className="ws-notice r67-tds">
            <span>
              The customer deducted {inr(inv.tdsDeducted)} TDS.{' '}
              {inv.tdsCertificateAt ? `Their certificate came in on ${day(inv.tdsCertificateAt)}.` : 'Their TDS certificate has not come in yet.'}
            </span>
            {mayChange && !inv.tdsCertificateAt ? (
              <button
                type="button"
                className="ws-btn ws-btn--quiet ws-btn--small"
                disabled={doing === 'tds'}
                onClick={async () => {
                  setDoing('tds');
                  try {
                    done(await opsTdsCertificate(inv.id, today()), 'Certificate noted as received.');
                  } catch (e) {
                    setDoing(null);
                    notify.error(errorWords(e, 'note the certificate'));
                  }
                }}
              >
                Certificate received
              </button>
            ) : null}
          </p>
        ) : null}

        {inv.status === 'ISSUED' && !inv.emailTo ? <p className="ws-item-sub">No email on this invoice and no owner to send to, so it cannot be emailed or reminded.</p> : null}

        <InvoiceDocument invoice={inv} />

        {numbered ? <EmailsSent sends={sends} /> : null}
      </div>

      {doing === 'edit' ? <InvoiceForm invoice={inv} onClose={() => setDoing(null)} onSaved={(r) => done(r)} /> : null}
      <ReasonDrawer
        open={doing === 'issue'}
        title={`Issue an invoice for ${inr(inv.total)} to ${inv.account?.name || inv.buyer?.name || 'the customer'}?`}
        what={`${inv.account?.name || inv.buyer?.name || 'The customer'} is billed ${inr(inv.total)}${inv.months ? ` for ${monthsWord(inv.months)}` : ''}. It gets the next number of this year’s series and today’s date, and nothing on it can change after.`}
        confirmLabel="Issue invoice"
        reasonOptional
        onClose={() => setDoing(null)}
        onConfirm={async () => {
          /* Always true or false, never left out: the server emails only on an explicit yes. */
          const r = await opsIssueInvoice(inv.id, Boolean(inv.emailTo) && emailIt);
          const books = r.books?.ok ? ' Sent to Books.' : '';
          if (r.emailed) done(r, `Issued and emailed to ${r.emailedTo}.${books}`);
          else if (r.emailError) {
            done(r);
            notify.error(`Issued. The email did not go: ${r.emailError}`);
          } else done(r, `Issued. Not emailed.${books}`);
        }}
      >
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={Boolean(inv.emailTo) && emailIt} disabled={!inv.emailTo} onChange={(e) => setEmailIt(e.target.checked)} aria-describedby="issue-email-note" />
          <span>
            <span className="font-semibold">{inv.emailTo ? `Email it to ${inv.emailTo}` : 'Email it to the customer'}</span>
            <span id="issue-email-note" className="ws-card-blurb" style={{ display: 'block' }}>
              {inv.emailTo
                ? `The email carries the invoice and how to pay ${inr(inv.total)}. Either way, ${inv.account?.name || 'the customer'} sees it in the Admin center, Billing.`
                : 'No email on this invoice and no owner to send to. Add the customer’s email to the draft first.'}
            </span>
          </span>
        </label>
      </ReasonDrawer>
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
        title={`Cancel ${inv.number} for ${inr(inv.total)}?`}
        what={`${inv.account?.name || inv.buyer?.name || 'The customer'} no longer owes ${inr(inv.total)} on ${inv.number}. It stays in the series, marked cancelled, and the customer sees nothing is due on it. A paid invoice cannot be cancelled.`}
        confirmLabel="Cancel invoice"
        cancelLabel="Keep invoice"
        tone="danger"
        onClose={() => setDoing(null)}
        onConfirm={async (reason) => done(await opsVoidInvoice(inv.id, reason), `${inv.number} is cancelled.`)}
      />
      {doing === 'paid' ? <MarkPaid inv={inv} onClose={() => setDoing(null)} onDone={(r) => done(r, r.paidUntil ? `Paid. ${inv.account?.name || 'The account'} is paid until ${day(r.paidUntil)}.` : 'Paid.')} /> : null}
    </>
  );
}

/* What one email was, in words. A reminder's step is how the schedule names it ("before:3", "due", "after:7"); one sent by hand says so. */
export function sendWords(s) {
  if (s.kind === 'ISSUED') return 'Invoice';
  if (s.kind === 'RESEND') return 'Sent again';
  const step = String(s.step || '').toLowerCase();
  if (!s.auto || step === 'manual') return 'Reminder: by hand';
  const n = Number((step.match(/\d+/) || [])[0] || 0);
  const days = `${n} ${n === 1 ? 'day' : 'days'}`;
  if (!n) return /due|^0$/.test(step) ? 'Reminder: on the due date' : 'Reminder';
  return /before|^-/.test(step) ? `Reminder: ${days} before due` : `Reminder: ${days} overdue`;
}

function EmailsSent({ sends }) {
  return (
    <section aria-labelledby="inv-emails" className="grid gap-2">
      <h2 id="inv-emails" className="ws-panel-title">
        Emails sent
      </h2>
      {sends === null ? (
        <Loading />
      ) : !sends.length ? (
        <p className="ws-card-blurb">Nothing sent yet.</p>
      ) : (
        <ul className="ws-list">
          {sends.map((s) => (
            <li key={s.id} className="ws-item" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span className="ws-item-text">
                <span className="ws-item-title">{sendWords(s)}</span>
                <span className="ws-item-sub">
                  To {s.toEmail}
                  {s.auto ? ' · automatic' : s.sentByName ? ` · ${s.sentByName}` : ''}
                  {s.delivery === 'FAILED' ? ` · not delivered${s.deliveryError ? `: ${s.deliveryError}` : ''}` : ''}
                </span>
              </span>
              <span className="ws-item-sub">{when(s.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MarkPaid({ inv, onClose, onDone }) {
  const [first] = useState(() => ({ reference: '', paidOn: today(), amount: rupeesText(inv.total), tds: '' }));
  const [f, setF] = useState(first);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [problems, setProblems] = useState({});
  const dirty = JSON.stringify(f) !== JSON.stringify(first);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const amount = toPaise(f.amount);
  const tds = f.tds.trim() ? toPaise(f.tds) : 0;
  /* Round 67: TDS the customer kept back. Until the amount is typed over, it follows the total less the TDS. */
  const setTds = (e) => {
    const v = e.target.value;
    setF((x) => {
      const followed = toPaise(x.amount) === inv.total - (x.tds.trim() ? toPaise(x.tds) || 0 : 0);
      const t = v.trim() ? toPaise(v) || 0 : 0;
      return { ...x, tds: v, amount: followed && t < inv.total ? rupeesText(inv.total - t) : x.amount };
    });
  };
  const save = async () => {
    setError('');
    const found = {};
    if (!/^[A-Za-z0-9/-]{6,40}$/.test(f.reference.trim())) found.reference = 'Enter the UTR or bank reference: 6 to 40 letters and digits.';
    if (!f.paidOn) found.paidOn = 'Enter the date the money arrived.';
    if (!amount) found.amount = 'Enter the amount received, in rupees, like 11800 or 11800.50.';
    if (f.tds.trim() && !tds) found.tds = 'Enter the TDS in rupees, or leave it empty.';
    setProblems(found);
    if (Object.keys(found).length) return;
    /* The last look: the amount, the customer, the months, and the shortfall when there is one. */
    const words = markPaidWords(inv, amount, tds);
    const ok = await confirmDialog({
      title: words.short ? `Mark ${inv.number} paid, ${inr(words.short)} short?` : `Mark ${inv.number} paid?`,
      message: words.message,
      confirmLabel: words.short ? 'Mark paid anyway' : 'Mark paid',
      cancelLabel: 'Go back',
      tone: words.short ? 'danger' : 'primary',
    });
    if (!ok) return;
    setBusy(true);
    try {
      onDone(await opsMarkInvoicePaid(inv.id, { reference: f.reference.trim(), paidOn: f.paidOn, amount, tdsDeducted: tds || null, acceptShort: words.short > 0 }));
    } catch (e) {
      setError(errorWords(e, 'mark the invoice paid'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <WsDrawer
      open
      onClose={() => !busy && onClose()}
      dirty={dirty || busy}
      title={`Mark ${inv.number} paid`}
      description={`A UPI or bank transfer that reached CLOR’s account. The subscription becomes active for ${inv.months === 1 ? '1 month' : `${inv.months} months`}, and the payment goes in the Payments log.`}
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <Button plain className="ws-btn ws-btn--primary" loading={busy} onClick={save}>
            Mark paid
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <HoldOpen active={busy} />
        <ErrorSummary errors={problems} />
        <Field id="paid-ref" label="UTR or bank reference" hint="The 12-digit UTR from the UPI app or the bank statement. The same reference cannot be used twice.">
          <input id="paid-ref" className="ui-input" autoComplete="off" spellCheck={false} value={f.reference} onChange={set('reference')} {...fieldErr(problems, 'reference', 'paid')} />
          <FieldMsg errors={problems} k="reference" idBase="paid" />
        </Field>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))' }}>
          <Field id="paid-on" label="Money arrived on">
            <input id="paid-on" className="ui-input" type="date" max={today()} value={f.paidOn} onChange={set('paidOn')} {...fieldErr(problems, 'paidOn', 'paid')} />
            <FieldMsg errors={problems} k="paidOn" idBase="paid" />
          </Field>
          <Field id="paid-amount" label="Amount received, ₹" hint={amount && amount + tds < inv.total ? `The invoice is for ${inr(inv.total)}: this is ${inr(inv.total - amount - tds)} short.` : amount && amount + tds !== inv.total ? `The invoice is for ${inr(inv.total)}.` : null}>
            <input id="paid-amount" className="ui-input ui-num" inputMode="decimal" value={f.amount} onChange={set('amount')} {...fieldErr(problems, 'amount', 'paid')} />
            <FieldMsg errors={problems} k="amount" idBase="paid" />
          </Field>
          <Field id="paid-tds" label="TDS deducted, ₹" hint="If the customer kept back tax at source. Their certificate is then chased under TDS certificates.">
            <input id="paid-tds" className="ui-input ui-num" inputMode="decimal" placeholder="None" value={f.tds} onChange={setTds} {...fieldErr(problems, 'tds', 'paid')} />
            <FieldMsg errors={problems} k="tds" idBase="paid" />
          </Field>
        </div>
        <p className="ws-card-blurb">Saving asks for a code from your authenticator app. It goes in the Staff audit log.</p>
        <Err>{error}</Err>
      </div>
    </WsDrawer>
  );
}
