import React, { useCallback, useEffect, useState } from 'react';

import { notify } from '@ui/components/ui/notify';
import { PageHead, Panel } from '../../apps/admin/src/screens/wsKit';
import { opsBooksChoices, opsInvoicing, opsRenewals, opsRunRenewals, opsSaveBooksLink, opsSaveInvoicing, opsSaveSelfServe, opsTestBooks } from './api';
import { Err, Loading, day, may } from './kit';

/**
 * Invoice settings (server: routes/opsInvoices.ts, billing/invoicing.ts).
 * How CLOR's invoices are numbered and worded, where the seller details and
 * the way to pay come from, and the CLOR Books connector (roadmap item 10):
 * which of CLOR's own Books companies receives each issued invoice as a
 * draft, switched on when CLOR is ready (a CA, the GSTIN). Nothing is in code.
 */
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

export function InvoiceSettings({ role, openTax, openPayments, openTemplates }) {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    opsInvoicing()
      .then((r) => (setS(r), setError('')))
      .catch((e) => setError(String(e?.message || e)));
  }, []);
  useEffect(load, [load]);
  if (!s) return error ? <Err>{error}</Err> : <Loading />;
  const mayChange = may(role, 'BILLING');
  return (
    <>
      <PageHead crumbs={['Billing and setup', 'Invoice settings']} title="Invoice settings" meta={`Next invoice: ${s.nextNumber}`} />
      <div className="grid gap-6" style={{ maxWidth: 820 }}>
        <Numbering s={s} mayChange={mayChange} onSaved={load} />
        <Renewals s={s} mayChange={mayChange} onSaved={load} />
        <Reminders s={s} mayChange={mayChange} onSaved={load} openTemplates={openTemplates} />
        <SelfServeSeats s={s} mayChange={mayChange} onSaved={load} />
        <Panel title="Seller and how customers pay">
          <dl className="grid gap-3" style={{ gridTemplateColumns: 'minmax(9rem, auto) 1fr' }}>
            <dt className="ws-item-sub">GST</dt>
            <dd>
              {s.gst.registered ? `Registered, GSTIN ${s.gst.gstin}, SAC ${s.gst.sac}, ${s.gst.ratePercent}%. Invoices are tax invoices.` : 'Not registered yet: invoices carry no GST.'}{' '}
              <button type="button" className="ws-name-link" onClick={openTax}>
                Change under Billing and setup, Tax
              </button>
            </dd>
            <dt className="ws-item-sub">Legal name</dt>
            <dd>{s.gst.legalName || 'Clor Applications Private Limited (set it under Billing and setup, Tax)'}</dd>
            <dt className="ws-item-sub">Way to pay</dt>
            <dd>
              {s.manualPayments ? 'UPI QR and bank account, from Manual: UPI and bank transfer.' : 'Not set up: invoices show no UPI QR or bank account.'}{' '}
              {s.online?.available ? `Customers can also pay online through ${s.online.gateway === 'razorpay' ? 'Razorpay' : 'Cashfree'}: card, UPI or netbanking.` : 'Online payment is off: turn on Razorpay or Cashfree to let customers pay by card.'}{' '}
              <button type="button" className="ws-name-link" onClick={openPayments}>
                {s.manualPayments ? 'Change under Billing and setup, Payments' : 'Set it up under Billing and setup, Payments'}
              </button>
            </dd>
          </dl>
        </Panel>
        <BooksConnector s={s} mayChange={mayChange} onSaved={load} />
      </div>
    </>
  );
}

function Numbering({ s, mayChange, onSaved }) {
  const [f, setF] = useState({ prefix: s.prefix, nextNumber: String(s.nextNumberValue), dueDays: String(s.dueDays), address: s.address || '', footer: s.footer || '' });
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: k === 'prefix' ? e.target.value.toUpperCase() : e.target.value }));
  const preview = `${f.prefix || 'CLOR'}/${s.financialYear}/${String(Number(f.nextNumber) || 1).padStart(4, '0')}`;
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setProblems([]);
    try {
      const body = { prefix: f.prefix, dueDays: Number(f.dueDays), address: f.address.trim() || null, footer: f.footer.trim() || null };
      if (Number(f.nextNumber) !== s.nextNumberValue) body.nextNumber = Number(f.nextNumber);
      await opsSaveInvoicing(body);
      notify.success('Saved.');
      onSaved();
    } catch (err) {
      setProblems(err?.data?.problems?.length ? err.data.problems : [String(err?.message || err)]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Numbering and wording">
      <form className="grid gap-5" onSubmit={save}>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))' }}>
          <Field id="inv-prefix" label="Prefix" hint="1 to 6 capital letters or digits.">
            <input id="inv-prefix" className="ui-input ui-mono" maxLength={6} disabled={!mayChange} value={f.prefix} onChange={set('prefix')} />
          </Field>
          <Field id="inv-next" label="Next number" hint={`The next one issued is ${preview}. It starts again at 1 each April.`}>
            <input id="inv-next" className="ui-input ui-num" inputMode="numeric" disabled={!mayChange} value={f.nextNumber} onChange={set('nextNumber')} />
          </Field>
          <Field id="inv-due" label="Payment due in, days">
            <input id="inv-due" className="ui-input ui-num" inputMode="numeric" disabled={!mayChange} value={f.dueDays} onChange={set('dueDays')} />
          </Field>
        </div>
        <Field id="inv-address" label="CLOR’s address on invoices">
          <textarea id="inv-address" className="ui-input" rows={3} disabled={!mayChange} value={f.address} onChange={set('address')} />
        </Field>
        <Field id="inv-footer" label="Line at the foot of every invoice (optional)" hint="For example: Questions about this invoice? Write to billing@clor.in.">
          <textarea id="inv-footer" className="ui-input" rows={2} disabled={!mayChange} value={f.footer} onChange={set('footer')} />
        </Field>
        <Problems list={problems} />
        {mayChange ? (
          <div>
            <button type="submit" className="ws-btn ws-btn--primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <span className="ws-card-blurb" style={{ marginLeft: 12 }}>
              Asks for a code from your authenticator app.
            </span>
          </div>
        ) : null}
      </form>
    </Panel>
  );
}

/**
 * Renewal invoices (server: billing/renewals.ts): on, how many days before a
 * paid period ends, what is coming up, and Issue now.
 */
function Renewals({ s: settings, mayChange, onSaved }) {
  const s = { ...settings, renewals: settings.renewals || { on: true, daysBefore: 7 } };
  const [on, setOn] = useState(s.renewals.on);
  const [days, setDays] = useState(String(s.renewals.daysBefore));
  const [busy, setBusy] = useState('');
  const [problems, setProblems] = useState([]);
  const [list, setList] = useState(null);
  const loadList = useCallback(() => {
    opsRenewals()
      .then((r) => setList(r?.upcoming || []))
      .catch(() => setList([]));
  }, []);
  useEffect(loadList, [loadList]);
  const changed = on !== s.renewals.on || Number(days) !== s.renewals.daysBefore;
  const save = async (e) => {
    e.preventDefault();
    setBusy('save');
    setProblems([]);
    try {
      await opsSaveInvoicing({ renewalsOn: on, renewalDaysBefore: Number(days) });
      notify.success(on ? `Renewal invoices go out ${days} ${Number(days) === 1 ? 'day' : 'days'} before each period ends.` : 'Renewal invoices are off. Finance drafts each one by hand.');
      onSaved();
      loadList();
    } catch (err) {
      setProblems(err?.data?.problems?.length ? err.data.problems : [String(err?.message || err)]);
    } finally {
      setBusy('');
    }
  };
  const runNow = async () => {
    setBusy('run');
    setProblems([]);
    try {
      const r = await opsRunRenewals();
      notify.success(r.issued ? `${r.issued} renewal ${r.issued === 1 ? 'invoice' : 'invoices'} issued.` : 'Nothing was due.');
      if (r.failed?.length) setProblems(r.failed.map((f) => f.reason));
      loadList();
    } catch (err) {
      setProblems([String(err?.message || err)]);
    } finally {
      setBusy('');
    }
  };
  const due = (list || []).filter((r) => r.dueNow && !r.invoice).length;
  return (
    <Panel title="Renewal invoices">
      <form className="grid gap-5" onSubmit={save}>
        <p className="ws-card-blurb">
          For a customer on a paid subscription, CLOR issues the next period’s invoice a few days before the paid period ends and emails the account owner. The offer’s price is used while the offer lasts, the list price after. A customer cancelling at the period end gets none.
        </p>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', alignItems: 'end' }}>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={on} disabled={!mayChange} onChange={(e) => setOn(e.target.checked)} />
            Issue renewal invoices on their own
          </label>
          <Field id="renew-days" label="Days before the period ends">
            <input id="renew-days" className="ui-input ui-num" inputMode="numeric" disabled={!mayChange || !on} value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 2))} style={{ maxWidth: '8rem' }} />
          </Field>
        </div>
        {list === null ? (
          <Loading />
        ) : list.length ? (
          <ul className="ws-list" aria-label="Renewals in the next 30 days">
            {list.map((r) => (
              <li key={r.accountId} className="ws-item" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span className="ws-item-text">
                  <span className="ws-item-title">{r.name}</span>
                  <span className="ws-item-sub">
                    {r.planName}, {r.interval === 'year' ? 'yearly' : 'monthly'} · renews {day(r.renewsOn)}
                  </span>
                </span>
                <span className="ws-item-sub">{r.invoice ? `Invoice ${r.invoice.number || 'drafted'}` : r.dueNow ? 'Due now' : 'Not yet'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ws-card-blurb">No paid subscription renews in the next 30 days.</p>
        )}
        <Problems list={problems} />
        {mayChange ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="ws-btn" disabled={Boolean(busy) || !changed || (on && !/^\d{1,2}$/.test(days))}>
              {busy === 'save' ? 'Saving…' : 'Save renewals'}
            </button>
            {s.renewals.on ? (
              <button type="button" className="ws-btn ws-btn--quiet" onClick={runNow} disabled={Boolean(busy) || !due}>
                {busy === 'run' ? 'Issuing…' : due ? `Issue the ${due} due now` : 'Nothing due now'}
              </button>
            ) : null}
            <span className="ws-card-blurb">Asks for a code from your authenticator app. It also runs on its own every six hours.</span>
          </div>
        ) : null}
      </form>
    </Panel>
  );
}

/**
 * Payment reminders (server: the reminder schedule in billing): off until
 * someone turns it on, which days around the due date a reminder goes, and
 * after how many CLOR stops. What turning it on would do today is said before
 * saving, because it emails customers.
 */
const NO_REMINDERS = { on: false, daysBefore: [3], onDueDate: true, daysAfter: [3, 7, 14], cap: 4, since: null };
const daysText = (list) => (list || []).join(', ');
const sameDays = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
/* "7, 3" as numbers; null when something in it is not a whole number. */
const daysIn = (text) => {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  return parts.every((p) => /^\d{1,3}$/.test(p)) ? parts.map(Number) : null;
};

function Reminders({ s: settings, mayChange, onSaved, openTemplates }) {
  const saved = { ...NO_REMINDERS, ...(settings.reminders || {}) };
  const [on, setOn] = useState(saved.on);
  const [before, setBefore] = useState(daysText(saved.daysBefore));
  const [onDue, setOnDue] = useState(saved.onDueDate);
  const [after, setAfter] = useState(daysText(saved.daysAfter));
  const [cap, setCap] = useState(String(saved.cap));
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);
  const b = daysIn(before);
  const a = daysIn(after);
  const changed = on !== saved.on || onDue !== saved.onDueDate || Number(cap) !== saved.cap || !b || !a || !sameDays(b, saved.daysBefore) || !sameDays(a, saved.daysAfter);
  /* While reminders are off the server's wouldRemindToday is 0; wouldRemindIfOn is the count turning them on would mail. */
  const would = settings.wouldRemindIfOn ?? settings.wouldRemindToday ?? 0;
  const save = async (e) => {
    e.preventDefault();
    const wrong = [];
    if (!b || b.length > 3 || b.some((d) => d < 1 || d > 30)) wrong.push('Days before the due date: up to three numbers, each from 1 to 30.');
    if (!a || a.length > 4 || a.some((d) => d < 1 || d > 60)) wrong.push('Days after the due date: up to four numbers, each from 1 to 60.');
    if (!/^[1-6]$/.test(cap)) wrong.push('Stop after this many reminders: a number from 1 to 6.');
    setProblems(wrong);
    if (wrong.length) return;
    setBusy(true);
    try {
      await opsSaveInvoicing({ remindersOn: on, reminderDaysBefore: b, reminderOnDueDate: onDue, reminderDaysAfter: a, reminderCap: Number(cap) });
      notify.success(on ? 'Reminders go out by themselves on the days you chose.' : 'Automatic reminders are off. Send reminder on an invoice still works.');
      onSaved();
    } catch (err) {
      setProblems(err?.data?.problems?.length ? err.data.problems : [String(err?.message || err)]);
    } finally {
      setBusy(false);
    }
  };
  const off = !mayChange || !on;
  return (
    <Panel title="Reminders">
      <form className="grid gap-5" onSubmit={save}>
        <p className="ws-card-blurb">
          CLOR can email a customer about an unpaid invoice before it is due, on the day, and after. A paid or cancelled invoice is never reminded, and reminders can be stopped for one invoice on its page.{' '}
          {openTemplates ? (
            <button type="button" className="ws-link" onClick={openTemplates}>
              See the wording
            </button>
          ) : null}
        </p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={on} disabled={!mayChange} onChange={(e) => setOn(e.target.checked)} />
          Remind customers automatically
        </label>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))' }}>
          <Field id="remind-before" label="Days before the due date" hint="Up to three, with commas: 7, 3. Leave empty for none.">
            <input id="remind-before" className="ui-input ui-num" inputMode="numeric" disabled={off} value={before} onChange={(e) => setBefore(e.target.value)} />
          </Field>
          <Field id="remind-after" label="Days after the due date" hint="Up to four, with commas: 3, 7, 14. Leave empty for none.">
            <input id="remind-after" className="ui-input ui-num" inputMode="numeric" disabled={off} value={after} onChange={(e) => setAfter(e.target.value)} />
          </Field>
          <Field id="remind-cap" label="Stop after this many reminders" hint="From 1 to 6 for one invoice.">
            <input id="remind-cap" className="ui-input ui-num" inputMode="numeric" disabled={off} value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, '').slice(0, 1))} style={{ maxWidth: '8rem' }} />
          </Field>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onDue} disabled={off} onChange={(e) => setOnDue(e.target.checked)} />
          On the due date
        </label>
        {saved.on ? (
          <p className="ws-card-blurb">{saved.since ? `On since ${day(saved.since)}.` : 'On.'} Invoices issued before that day are never reminded automatically.</p>
        ) : on ? (
          <p className="ws-notice" role="status">
            {would === 1 ? '1 invoice would be reminded today.' : `${would} invoices would be reminded today.`} Invoices issued before today are never reminded automatically.
          </p>
        ) : null}
        <Problems list={problems} />
        {mayChange ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="ws-btn" disabled={busy || !changed}>
              {busy ? 'Saving…' : 'Save reminders'}
            </button>
            <span className="ws-card-blurb">Asks for a code from your authenticator app. It runs on its own through the day.</span>
          </div>
        ) : null}
      </form>
    </Panel>
  );
}

/**
 * Seats customers add themselves (server: billing/selfServe.ts): off until
 * switched on. On, a customer on an active paid plan priced by the user or
 * the employee adds seats from Workspace; they work at once and a prorated
 * invoice is issued, due in the days to pay. Unpaid by then, that invoice is
 * cancelled and those seats come off by themselves.
 */
const NO_SELF_SERVE = { on: false, maxPerChange: 20, payDays: 14 };
function SelfServeSeats({ s: settings, mayChange, onSaved }) {
  const saved = { ...NO_SELF_SERVE, ...(settings.selfServe || {}) };
  const [on, setOn] = useState(saved.on);
  const [max, setMax] = useState(String(saved.maxPerChange));
  const [daysToPay, setDaysToPay] = useState(String(saved.payDays));
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);
  const changed = on !== saved.on || Number(max) !== saved.maxPerChange || Number(daysToPay) !== saved.payDays;
  const save = async (e) => {
    e.preventDefault();
    const wrong = [];
    if (!/^\d{1,3}$/.test(max) || Number(max) < 1 || Number(max) > 500) wrong.push('At most at a time: a number from 1 to 500.');
    if (!/^\d{1,2}$/.test(daysToPay) || Number(daysToPay) < 3 || Number(daysToPay) > 30) wrong.push('Days to pay: a number from 3 to 30.');
    setProblems(wrong);
    if (wrong.length) return;
    setBusy(true);
    try {
      await opsSaveSelfServe({ on, maxPerChange: Number(max), payDays: Number(daysToPay) });
      notify.success(on ? 'Customers can add seats themselves.' : 'Customers ask CLOR to add seats.');
      onSaved();
    } catch (err) {
      setProblems(err?.data?.problems?.length ? err.data.problems : [String(err?.message || err)]);
    } finally {
      setBusy(false);
    }
  };
  const off = !mayChange || !on;
  return (
    <Panel title="Seats customers add themselves">
      <form className="grid gap-5" onSubmit={save}>
        <p className="ws-card-blurb">
          A customer on an active paid plan, priced by the user or the employee, with nothing overdue, adds seats from Workspace. They work at once, and an invoice for the rest of the paid period is issued and emailed. If it is not paid within the days to pay, it is cancelled and those seats come off. Removing seats, apps and refunds stay with CLOR.
        </p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={on} disabled={!mayChange} onChange={(e) => setOn(e.target.checked)} />
          Let customers add seats themselves
        </label>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))' }}>
          <Field id="seats-max" label="At most at a time" hint="From 1 to 500. More than this is a request to CLOR.">
            <input id="seats-max" className="ui-input ui-num" inputMode="numeric" disabled={off} value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, '').slice(0, 3))} style={{ maxWidth: '8rem' }} />
          </Field>
          <Field id="seats-days" label="Days to pay" hint="From 3 to 30. Then the seats come off.">
            <input id="seats-days" className="ui-input ui-num" inputMode="numeric" disabled={off} value={daysToPay} onChange={(e) => setDaysToPay(e.target.value.replace(/\D/g, '').slice(0, 2))} style={{ maxWidth: '8rem' }} />
          </Field>
        </div>
        <Problems list={problems} />
        {mayChange ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="ws-btn" disabled={busy || !changed}>
              {busy ? 'Saving…' : 'Save seat settings'}
            </button>
            <span className="ws-card-blurb">Asks for a code from your authenticator app.</span>
          </div>
        ) : null}
      </form>
    </Panel>
  );
}

function BooksConnector({ s, mayChange, onSaved }) {
  const b = s.books;
  const [picking, setPicking] = useState(!b.orgId);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState([]);
  const [pick, setPick] = useState({ accountId: b.accountId || '', orgId: b.orgId || '', branchId: b.branchId || '' });
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!picking) return undefined;
    let live = true;
    const t = setTimeout(() => {
      opsBooksChoices(search.trim())
        .then((r) => live && setFound(r.accounts))
        .catch(() => {});
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [search, picking]);

  const save = async (body, message) => {
    setBusy('save');
    setError('');
    try {
      await opsSaveBooksLink(body);
      notify.success(message);
      setPicking(false);
      onSaved();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy('');
    }
  };
  const runTest = async () => {
    setBusy('test');
    try {
      setTest(await opsTestBooks());
    } catch (e) {
      setTest({ ok: false, message: String(e?.message || e) });
    } finally {
      setBusy('');
    }
  };
  const account = found.find((a) => a.id === pick.accountId);
  const company = account?.companies.find((c) => c.id === pick.orgId);

  return (
    <Panel title="CLOR Books connector">
      <div className="grid gap-5">
        <p className="ws-card-blurb">Each invoice issued here is copied into CLOR’s own company in CLOR Books as a draft, with the same number. Nothing reaches CLOR’s accounts or GST returns until someone checks the draft in Books and saves it.</p>
        <div className="flex items-center gap-3 flex-wrap">
          {b.enabled ? <span className="ws-pill ws-pill--ok">On</span> : <span className="ws-pill ws-pill--off">Off</span>}
          <span>{b.companyName ? `${b.companyName}, branch ${b.branchName || '—'} (account ${b.accountName}${b.accountCode ? `, ${b.accountCode}` : ''})` : 'No Books company chosen yet.'}</span>
        </div>

        {picking && mayChange ? (
          <div className="grid gap-4">
            <Field id="books-search" label="CLOR’s account" hint="Type the account’s name, its company’s name or its client ID.">
              <input id="books-search" className="ui-input" autoComplete="off" value={search} onChange={(e) => setSearch(e.target.value)} />
            </Field>
            {found.length ? (
              <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))' }}>
                <Field id="books-account" label="Account">
                  <select id="books-account" className="ui-input" value={pick.accountId} onChange={(e) => setPick({ accountId: e.target.value, orgId: '', branchId: '' })}>
                    <option value="">Choose</option>
                    {found.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.code ? ` (${a.code})` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="books-company" label="Company">
                  <select id="books-company" className="ui-input" disabled={!account} value={pick.orgId} onChange={(e) => setPick((p) => ({ ...p, orgId: e.target.value, branchId: '' }))}>
                    <option value="">Choose</option>
                    {(account?.companies || []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="books-branch" label="Branch">
                  <select id="books-branch" className="ui-input" disabled={!company} value={pick.branchId} onChange={(e) => setPick((p) => ({ ...p, branchId: e.target.value }))}>
                    <option value="">Choose</option>
                    {(company?.branches || []).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : search.trim() ? (
              <span className="ws-item-sub">No account matches.</span>
            ) : null}
            <div className="flex gap-2">
              <button type="button" className="ws-btn ws-btn--quiet" disabled={!pick.branchId || busy === 'save'} onClick={() => save(pick, 'Books company chosen. Test the connection, then switch it on.')}>
                Use this company
              </button>
              {b.orgId ? (
                <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setPicking(false)}>
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {b.orgId ? (
          <>
            <label className="flex items-start gap-3">
              <input type="checkbox" disabled={!mayChange || busy === 'save'} checked={b.autoSend} onChange={(e) => save({ autoSend: e.target.checked }, e.target.checked ? 'Each invoice now goes to Books when it is issued.' : 'Invoices go to Books only when you send them.')} />
              <span>
                <span className="font-medium">Send each invoice by itself when it is issued</span>
                <span className="ws-card-blurb" style={{ display: 'block' }}>
                  Off, an invoice goes to Books when someone presses Send to Books on it.
                </span>
              </span>
            </label>
            {test ? (
              <p role="status" className="text-sm" style={{ color: test.ok ? 'rgb(var(--ws-ok))' : 'rgb(var(--ws-danger))' }}>
                {test.message}
              </p>
            ) : null}
            {mayChange ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="ws-btn ws-btn--quiet" disabled={busy === 'test'} onClick={runTest}>
                  {busy === 'test' ? 'Testing…' : 'Test connection'}
                </button>
                <button type="button" className="ws-btn ws-btn--quiet" disabled={busy === 'save'} onClick={() => save({ enabled: !b.enabled }, b.enabled ? 'The connector is off. Nothing more goes to Books.' : 'The connector is on.')}>
                  {b.enabled ? 'Switch off' : 'Switch on'}
                </button>
                {!picking ? (
                  <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setPicking(true)}>
                    Choose another company
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
        <Err>{error}</Err>
      </div>
    </Panel>
  );
}
