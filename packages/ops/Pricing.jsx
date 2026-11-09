import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';

import { notify } from '@ui/components/ui/notify';
import { PageHead, Panel, WsDrawer } from '../../apps/admin/src/screens/wsKit';
import { opsArchivePriceBook, opsNewPriceBook, opsPriceBook, opsPricePreview, opsPricing, opsPublishPriceBook, opsRollBackPriceBook, opsSamplePlans, opsSavePriceBook } from './api';
import { inr, rupeesText, toPaise } from './money';

/**
 * Pricing (server: routes/pricing.ts). CLOR's price list is made here and
 * nowhere else: a price book is a version, made empty or as a copy, its plans
 * added and edited, previewed as clor.in will show them, then published.
 * Publishing replaces the price list on clor.in at once; the version it
 * replaces is kept. A published book can be archived (the site then shows
 * Request a demo) and an older one brought back. Subscriptions already
 * running keep their own prices.
 */
const STATUS = { DRAFT: 'Draft', PUBLISHED: 'On clor.in', ARCHIVED: 'Archived' };
const UNIT = { COMPANY: 'company', USER: 'user', EMPLOYEE: 'employee' };
const UNITS = { COMPANY: 'companies', USER: 'users', EMPLOYEE: 'employees' };
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const may = (role, ...roles) => role === 'SUPER_ADMIN' || roles.includes(role);
const Err = ({ children }) =>
  children ? (
    <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>
      {children}
    </p>
  ) : null;
const priceOf = (plan, period) => plan.prices.find((p) => p.period === period);
/* The yearly price the engine will work out, for a plan with a yearly discount (same rounding: half up, in paise). */
const pct = (paise, keep) => Math.floor((paise * keep + 50) / 100);
function effective(plan, period) {
  if (!plan.periods.includes(period)) return null;
  if (period === 'YEARLY' && plan.yearlyDiscountPct != null) {
    const m = priceOf(plan, 'MONTHLY');
    if (!m) return null;
    const keep = 100 - plan.yearlyDiscountPct;
    return { basePrice: pct(m.basePrice * 12, keep), extraUnitPrice: pct(m.extraUnitPrice * 12, keep) };
  }
  return priceOf(plan, period) || null;
}

export function StatusPill({ status }) {
  return <span className={status === 'PUBLISHED' ? 'ws-pill ws-pill--ok' : status === 'DRAFT' ? 'ws-pill ws-pill--warn' : 'ws-pill ws-pill--off'}>{STATUS[status] || status}</span>;
}

/** A confirm step for the acts that change clor.in. */
function Confirm({ open, title, text, action, busyLabel, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) setError('');
  }, [open]);
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <WsDrawer
      open={open}
      onClose={onClose}
      title={title}
      description={text}
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ws-btn ws-btn--primary" disabled={busy} onClick={go}>
            {busy ? busyLabel : action}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <p className="ws-card-blurb">You will be asked for a code from your authenticator app. It goes on the operator log.</p>
        <Err>{error}</Err>
      </div>
    </WsDrawer>
  );
}

/* ------------------------------------------------------------- the list */
export function Pricing({ role }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [bookId, setBookId] = useState('');
  const [making, setMaking] = useState(false);
  const load = useCallback(() => {
    opsPricing()
      .then((r) => (setData(r), setError('')))
      .catch((e) => setError(String(e?.message || e)));
  }, []);
  useEffect(load, [load]);

  if (bookId) return <PriceBook id={bookId} role={role} catalogue={data?.apps || []} back={() => (setBookId(''), load())} open={setBookId} />;
  if (!data) return error ? <Err>{error}</Err> : <p className="ws-card-blurb">Loading…</p>;
  const live = data.books.find((b) => b.status === 'PUBLISHED');
  const draft = data.books.find((b) => b.status === 'DRAFT');
  const mayChange = may(role, 'BILLING');
  return (
    <>
      <PageHead
        crumbs={['Operator']}
        title="Pricing"
        meta={live ? `Version ${live.version} is on clor.in, since ${day(live.publishedAt)}` : 'Nothing published: clor.in shows Request a demo'}
        actions={
          draft ? (
            <button type="button" className="ws-btn ws-btn--primary" onClick={() => setBookId(draft.id)}>
              Open the draft
            </button>
          ) : mayChange ? (
            <button type="button" className="ws-btn ws-btn--primary" onClick={() => setMaking(true)}>
              New price book
            </button>
          ) : null
        }
      />
      <p className="ws-notice">{data.tax.registered ? `GST is charged at ${data.tax.ratePercent}%. ` : 'No GST is charged: CLOR is not registered for GST yet. '}Change it in Settings, Tax.</p>
      {data.books.length === 0 ? (
        <div className="ws-empty">
          <p>No price book yet. Make one with New price book: start empty, or load the sample prices and change them.</p>
        </div>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Price books, newest first</caption>
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th className="num">Plans</th>
                <th>Published</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {data.books.map((b) => (
                <tr key={b.id}>
                  <td>
                    <button type="button" className="ws-name-link" onClick={() => setBookId(b.id)}>
                      Version {b.version}
                    </button>
                  </td>
                  <td>
                    <StatusPill status={b.status} />
                  </td>
                  <td className="num">{b.planCount}</td>
                  <td>{day(b.publishedAt)}</td>
                  <td style={{ whiteSpace: 'normal' }}>{b.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NewBook open={making} live={live} onClose={() => setMaking(false)} onMade={(id) => (setMaking(false), setBookId(id))} />
    </>
  );
}

function NewBook({ open, live, onClose, onMade }) {
  const [from, setFrom] = useState('copy');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) (setFrom(live ? 'copy' : 'empty'), setError(''));
  }, [open, live]);
  const make = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await opsNewPriceBook(from === 'empty' ? { empty: true } : {});
      notify.success(`Version ${r.book.version} is a draft. Nothing changes on clor.in until you publish it.`);
      onMade(r.book.id);
    } catch (e) {
      if (e?.data?.draftId) return onMade(e.data.draftId);
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <WsDrawer
      open={open}
      onClose={onClose}
      title="New price book"
      description="A draft to edit. clor.in keeps showing what is published until you publish this one."
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ws-btn ws-btn--primary" disabled={busy} onClick={make}>
            {busy ? 'Making…' : 'Make the draft'}
          </button>
        </>
      }
    >
      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium" style={{ marginBottom: 6 }}>
          Start from
        </legend>
        {live ? (
          <label className="flex gap-2 items-start">
            <input type="radio" name="ops-new-book" checked={from === 'copy'} onChange={() => setFrom('copy')} />
            <span>A copy of version {live.version}, the one on clor.in now</span>
          </label>
        ) : null}
        <label className="flex gap-2 items-start">
          <input type="radio" name="ops-new-book" checked={from === 'empty'} onChange={() => setFrom('empty')} />
          <span>Empty. You can load the sample prices into it and change them.</span>
        </label>
        <Err>{error}</Err>
      </fieldset>
    </WsDrawer>
  );
}

/* ------------------------------------------------------------ one book */
function PriceBook({ id, role, catalogue, back, open }) {
  const [book, setBook] = useState(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState('');
  const load = useCallback(() => {
    opsPriceBook(id)
      .then((r) => (setBook(r.book), setError('')))
      .catch((e) => setError(String(e?.message || e)));
  }, [id]);
  useEffect(load, [load]);
  if (!book) return error ? <Err>{error}</Err> : <p className="ws-card-blurb">Loading…</p>;
  const mayChange = may(role, 'BILLING');
  const backButton = (
    <div>
      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={back}>
        <ArrowLeft size={14} aria-hidden="true" /> Pricing
      </button>
    </div>
  );
  if (book.status === 'DRAFT') return <DraftEditor book={book} mayChange={mayChange} catalogue={catalogue} backButton={backButton} reload={load} back={back} />;

  return (
    <>
      {backButton}
      <PageHead
        crumbs={['Operator · Pricing']}
        title={`Version ${book.version}`}
        meta={
          <>
            <StatusPill status={book.status} /> {book.status === 'PUBLISHED' ? `since ${day(book.publishedAt)}` : `archived ${day(book.archivedAt)}`}
          </>
        }
        actions={
          mayChange ? (
            book.status === 'ARCHIVED' ? (
              <button type="button" className="ws-btn ws-btn--primary" onClick={() => setConfirm('rollback')}>
                Bring this version back
              </button>
            ) : (
              <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setConfirm('archive')}>
                Take prices off clor.in
              </button>
            )
          ) : null
        }
      />
      {book.note ? <p className="ws-card-blurb">{book.note}</p> : null}
      <p className="ws-card-blurb">A version that was published is never changed. To change prices, make a new price book from Pricing: it starts as a copy of this one.</p>
      <PlanTable plans={book.plans} catalogue={catalogue} />
      <Confirm
        open={confirm === 'archive'}
        title={`Take version ${book.version} off clor.in?`}
        text="clor.in stops showing prices and shows Request a demo instead, until another version is published. Customers already subscribed keep their prices. The version is kept and can be brought back."
        action="Take prices off"
        busyLabel="Taking off…"
        onClose={() => setConfirm('')}
        onConfirm={async () => {
          await opsArchivePriceBook(book.id);
          notify.success('Prices are off clor.in. It shows Request a demo.');
          setConfirm('');
          load();
        }}
      />
      <Confirm
        open={confirm === 'rollback'}
        title={`Bring version ${book.version} back?`}
        text={`Its plans and prices go on clor.in at once, as a new version copied from version ${book.version}. The version on clor.in now is archived and kept. Customers already subscribed keep their prices.`}
        action="Bring it back"
        busyLabel="Publishing…"
        onClose={() => setConfirm('')}
        onConfirm={async () => {
          const r = await opsRollBackPriceBook(book.id);
          notify.success(`Version ${r.book.version}, a copy of version ${book.version}, is on clor.in.`);
          setConfirm('');
          open(r.book.id);
        }}
      />
    </>
  );
}

const appNames = (codes, catalogue) => codes.map((c) => catalogue.find((a) => a.code === c)?.name || c).join(', ');
const priceCell = (plan, period) => {
  const p = effective(plan, period);
  if (!p) return <span className="ws-item-sub">Not offered</span>;
  return (
    <>
      <div>{inr(p.basePrice)}</div>
      <div className="ws-item-sub">
        {p.extraUnitPrice ? `+ ${inr(p.extraUnitPrice)} a ${UNIT[plan.unit]}` : `no charge per ${UNIT[plan.unit]}`}
        {period === 'YEARLY' && plan.yearlyDiscountPct != null ? ` · ${plan.yearlyDiscountPct}% off` : ''}
      </div>
    </>
  );
};

/** The plans of a book, read-only or with an Edit button on each. */
function PlanTable({ plans, catalogue, onEdit, onRemove }) {
  if (!plans.length)
    return (
      <div className="ws-empty">
        <p>No plans yet.</p>
      </div>
    );
  return (
    <div className="ws-table-wrap">
      <table className="ws-table">
        <caption className="sr-only">Plans in the order clor.in shows them</caption>
        <thead>
          <tr>
            <th>Plan</th>
            <th>Apps</th>
            <th>Counted per</th>
            <th className="num">Monthly</th>
            <th className="num">Yearly</th>
            <th className="num">Trial</th>
            <th>On clor.in</th>
            {onEdit ? (
              <th>
                <span className="sr-only">Change</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {plans.map((p, i) => (
            <tr key={`${p.code}-${i}`}>
              <td>
                {onEdit ? (
                  <button type="button" className="ws-name-link" onClick={() => onEdit(i)}>
                    {p.name || 'New plan'}
                  </button>
                ) : (
                  <span className="font-medium">{p.name}</span>
                )}
                <div className="ws-item-sub ui-mono">{p.code}</div>
              </td>
              <td style={{ whiteSpace: 'normal' }}>{appNames(p.apps, catalogue) || '—'}</td>
              <td>
                {UNIT[p.unit]}
                <div className="ws-item-sub">{p.includedUnits} included</div>
              </td>
              <td className="num">{priceCell(p, 'MONTHLY')}</td>
              <td className="num">{priceCell(p, 'YEARLY')}</td>
              <td className="num">{p.trialDays ? `${p.trialDays} days` : 'None'}</td>
              <td>{!p.showOnWebsite ? 'Hidden' : p.apps.some((a) => !catalogue.find((c) => c.code === a)?.available) ? 'Hidden until the app is ready' : p.highlight ? 'Shown, highlighted' : 'Shown'}</td>
              {onEdit ? (
                <td>
                  <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => onRemove(i)}>
                    Remove
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------ the draft */
const blankPlan = (n) => ({
  code: '',
  name: '',
  description: '',
  apps: [],
  unit: 'USER',
  includedUnits: 1,
  trialDays: 30,
  periods: ['MONTHLY', 'YEARLY'],
  yearlyDiscountPct: null,
  displayOrder: (n + 1) * 10,
  showOnWebsite: true,
  highlight: false,
  gstApplies: true,
  prices: [
    { period: 'MONTHLY', basePrice: 0, extraUnitPrice: 0 },
    { period: 'YEARLY', basePrice: 0, extraUnitPrice: 0 },
  ],
});

function DraftEditor({ book, mayChange, catalogue, backButton, reload, back }) {
  const [plans, setPlans] = useState(book.plans);
  const [note, setNote] = useState(book.note || '');
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState([]);
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    setPlans(book.plans);
    setNote(book.note || '');
  }, [book]);
  const dirty = JSON.stringify(plans) !== JSON.stringify(book.plans) || note.trim() !== (book.note || '');

  const save = async () => {
    setSaving(true);
    setProblems([]);
    try {
      await opsSavePriceBook(book.id, { plans, note: note.trim() || null });
      notify.success('Draft saved. Nothing changes on clor.in until you publish.');
      reload();
    } catch (e) {
      setProblems(e?.data?.problems || [String(e?.message || e)]);
    } finally {
      setSaving(false);
    }
  };
  const loadSample = async () => {
    const r = await opsSamplePlans();
    setPlans(r.plans);
    if (!note.trim()) setNote(r.note);
    notify.success('Sample prices loaded into the draft. Change them, then save.');
  };

  return (
    <>
      {backButton}
      <PageHead
        crumbs={['Operator · Pricing']}
        title={`Version ${book.version}, draft`}
        meta={dirty ? 'Changes not saved' : 'Saved. Not on clor.in yet'}
        actions={
          mayChange ? (
            <button type="button" className="ws-btn ws-btn--primary" disabled={dirty || !plans.length} title={dirty ? 'Save the draft first' : undefined} onClick={() => setConfirm('publish')}>
              Publish
            </button>
          ) : null
        }
      />
      <div className="ws-layout">
        <div className="ws-main">
          <label className="grid gap-1">
            <span className="text-sm font-medium">Note</span>
            <input className="ui-input" value={note} maxLength={200} disabled={!mayChange} onChange={(e) => setNote(e.target.value)} placeholder="What changed in this version" />
            <span className="ws-card-blurb">For the team. While it says sample or not final, clor.in adds “Prices are being finalised”.</span>
          </label>
          <PlanTable plans={plans} catalogue={catalogue} onEdit={mayChange ? setEditing : null} onRemove={(i) => setPlans((ps) => ps.filter((_, j) => j !== i))} />
          {problems.length ? (
            <div role="alert" className="grid gap-1">
              <p className="text-sm font-medium" style={{ color: 'rgb(var(--ws-danger))' }}>
                Not saved. Fix these first:
              </p>
              <ul className="text-sm" style={{ color: 'rgb(var(--ws-danger))', paddingLeft: 18, listStyle: 'disc' }}>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {mayChange ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setEditing(plans.length)}>
                Add a plan
              </button>
              <button type="button" className="ws-btn ws-btn--quiet" onClick={loadSample}>
                {plans.length ? 'Replace with sample prices' : 'Load sample prices'}
              </button>
              <button type="button" className="ws-btn ws-btn--quiet" disabled={!dirty || saving} onClick={save}>
                {saving ? 'Saving…' : 'Save draft'}
              </button>
              <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setConfirm('discard')}>
                Discard draft
              </button>
            </div>
          ) : null}
        </div>
        <aside className="ws-side">
          <Preview plans={plans} catalogue={catalogue} />
        </aside>
      </div>
      {editing != null ? (
        <PlanDrawer
          key={editing}
          open
          plan={plans[editing] || blankPlan(plans.length)}
          isNew={!plans[editing]}
          catalogue={catalogue}
          takenCodes={plans.filter((_, i) => i !== editing).map((p) => p.code)}
          onClose={() => setEditing(null)}
          onDone={(p) => {
            setPlans((ps) => {
              const next = [...ps];
              next[editing] = p;
              return next;
            });
            setEditing(null);
          }}
        />
      ) : null}
      <Confirm
        open={confirm === 'publish'}
        title={`Publish version ${book.version}?`}
        text="Its plans and prices go on clor.in and into every new quote straight away. The version on clor.in now is archived and kept, and can be brought back. Customers already subscribed keep their prices."
        action="Publish"
        busyLabel="Publishing…"
        onClose={() => setConfirm('')}
        onConfirm={async () => {
          await opsPublishPriceBook(book.id);
          notify.success(`Version ${book.version} is on clor.in.`);
          setConfirm('');
          reload();
        }}
      />
      <Confirm
        open={confirm === 'discard'}
        title={`Discard version ${book.version}?`}
        text="The draft is archived, not deleted. clor.in does not change."
        action="Discard"
        busyLabel="Discarding…"
        onClose={() => setConfirm('')}
        onConfirm={async () => {
          await opsArchivePriceBook(book.id);
          notify.success('Draft discarded.');
          setConfirm('');
          back();
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------- one plan */
const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

/** A labelled field with its help line. */
function Field({ id, label, hint, children }) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <span className="ws-card-blurb">{hint}</span> : null}
    </div>
  );
}

function PlanDrawer({ open, plan, isNew, catalogue, takenCodes, onClose, onDone }) {
  const [f, setF] = useState(() => {
    const m = priceOf(plan, 'MONTHLY');
    const y = priceOf(plan, 'YEARLY');
    return {
      ...plan,
      description: plan.description || '',
      codeTouched: !isNew,
      mBase: rupeesText(m?.basePrice),
      mExtra: rupeesText(m?.extraUnitPrice),
      yBase: rupeesText(y?.basePrice),
      yExtra: rupeesText(y?.extraUnitPrice),
      yearlyMode: plan.yearlyDiscountPct != null ? 'discount' : 'own',
      discount: plan.yearlyDiscountPct != null ? String(plan.yearlyDiscountPct) : '',
    };
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => {
    const v = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setF((x) => ({ ...x, [k]: v, ...(k === 'name' && !x.codeTouched ? { code: slug(v) } : {}), ...(k === 'code' ? { codeTouched: true } : {}) }));
  };
  const toggle = (k, v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const monthly = f.periods.includes('MONTHLY');
  const yearly = f.periods.includes('YEARLY');
  const unit = UNIT[f.unit];

  const done = (e) => {
    e.preventDefault();
    const amounts = [
      monthly && ['mBase', 'monthly price'],
      monthly && ['mExtra', 'monthly price for each extra'],
      yearly && f.yearlyMode === 'own' && ['yBase', 'yearly price'],
      yearly && f.yearlyMode === 'own' && ['yExtra', 'yearly price for each extra'],
    ].filter(Boolean);
    for (const [k, label] of amounts) if (toPaise(f[k] || '0') == null) return setError(`The ${label} is an amount in rupees, like 499 or 499.50.`);
    if (!f.name.trim()) return setError('Give the plan a name.');
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(f.code)) return setError('The code is small letters, numbers and dashes, like books-starter.');
    if (takenCodes.includes(f.code)) return setError('Another plan in this book has that code.');
    if (!f.apps.length) return setError('Choose at least one app.');
    if (!f.periods.length) return setError('Offer it monthly, yearly or both.');
    const discount = yearly && f.yearlyMode === 'discount' ? Number(f.discount) : null;
    if (discount != null && !(Number.isInteger(discount) && discount >= 0 && discount <= 90)) return setError('The yearly discount is a whole percent from 0 to 90.');
    const prices = [];
    if (monthly || discount != null) prices.push({ period: 'MONTHLY', basePrice: toPaise(f.mBase || '0'), extraUnitPrice: toPaise(f.mExtra || '0') });
    if (yearly && discount == null) prices.push({ period: 'YEARLY', basePrice: toPaise(f.yBase || '0'), extraUnitPrice: toPaise(f.yExtra || '0') });
    onDone({
      code: f.code,
      name: f.name.trim(),
      description: f.description.trim() || null,
      apps: catalogue.map((a) => a.code).filter((c) => f.apps.includes(c)),
      unit: f.unit,
      includedUnits: Math.max(1, Number.parseInt(f.includedUnits, 10) || 1),
      trialDays: Math.max(0, Number.parseInt(f.trialDays, 10) || 0),
      periods: ['MONTHLY', 'YEARLY'].filter((p) => f.periods.includes(p)),
      yearlyDiscountPct: discount,
      displayOrder: Math.max(0, Number.parseInt(f.displayOrder, 10) || 0),
      showOnWebsite: Boolean(f.showOnWebsite),
      highlight: Boolean(f.highlight),
      gstApplies: Boolean(f.gstApplies),
      prices,
    });
  };

  const money = (k, id) => <input id={id} className="ui-input ui-num" style={{ maxWidth: 160, textAlign: 'right' }} inputMode="decimal" value={f[k]} onChange={set(k)} placeholder="0" />;

  return (
    <WsDrawer
      open={open}
      onClose={onClose}
      title={isNew ? 'Add a plan' : `Change ${plan.name}`}
      description="Amounts are in rupees, before GST. The draft keeps this when you press Done; save the draft to keep it for good."
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="ops-plan" className="ws-btn ws-btn--primary">
            Done
          </button>
        </>
      }
    >
      <form id="ops-plan" className="grid gap-5" onSubmit={done}>
        <Err>{error}</Err>
        <Field id="ops-plan-name" label="Name" hint="As customers see it, like Books Starter.">
          <input id="ops-plan-name" className="ui-input" value={f.name} maxLength={60} onChange={set('name')} />
        </Field>
        <Field id="ops-plan-code" label="Code" hint="Small letters and dashes. It goes in the free-trial link, so keep it once customers use it.">
          <input id="ops-plan-code" className="ui-input ui-mono" value={f.code} maxLength={32} onChange={set('code')} />
        </Field>
        <Field id="ops-plan-desc" label="Description" hint="One line under the name on clor.in.">
          <textarea id="ops-plan-desc" className="ui-input" rows={2} maxLength={300} value={f.description} onChange={set('description')} />
        </Field>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium" style={{ marginBottom: 6 }}>
            Apps in this plan
          </legend>
          {catalogue.map((a) => (
            <label key={a.code} className="flex gap-2 items-start">
              <input type="checkbox" checked={f.apps.includes(a.code)} onChange={() => toggle('apps', a.code)} />
              <span>
                {a.name}
                {a.available ? null : <span className="ws-item-sub"> · coming soon: the plan stays off clor.in until it is ready</span>}
              </span>
            </label>
          ))}
        </fieldset>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <Field id="ops-plan-unit" label="Counted per" hint="What one unit is.">
            <select id="ops-plan-unit" className="ui-select" value={f.unit} onChange={set('unit')}>
              <option value="COMPANY">Company</option>
              <option value="USER">User who signs in</option>
              <option value="EMPLOYEE">Employee</option>
            </select>
          </Field>
          <Field id="ops-plan-included" label={`${UNITS[f.unit][0].toUpperCase()}${UNITS[f.unit].slice(1)} included`} hint={`The base price covers this many ${UNITS[f.unit]}.`}>
            <input id="ops-plan-included" className="ui-input ui-num" style={{ maxWidth: 120 }} type="number" min={1} value={f.includedUnits} onChange={set('includedUnits')} />
          </Field>
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium" style={{ marginBottom: 6 }}>
            Offered
          </legend>
          <label className="flex gap-2">
            <input type="checkbox" checked={monthly} onChange={() => toggle('periods', 'MONTHLY')} /> Monthly
          </label>
          <label className="flex gap-2">
            <input type="checkbox" checked={yearly} onChange={() => toggle('periods', 'YEARLY')} /> Yearly
          </label>
        </fieldset>
        {monthly || (yearly && f.yearlyMode === 'discount') ? (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <Field id="ops-plan-mbase" label="Monthly price, ₹" hint={`For up to ${f.includedUnits} ${UNITS[f.unit]}.`}>
              {money('mBase', 'ops-plan-mbase')}
            </Field>
            <Field id="ops-plan-mextra" label={`Each extra ${unit} a month, ₹`} hint="0 if more cost nothing.">
              {money('mExtra', 'ops-plan-mextra')}
            </Field>
          </div>
        ) : null}
        {yearly ? (
          <fieldset className="grid gap-3">
            <legend className="text-sm font-medium" style={{ marginBottom: 6 }}>
              Yearly price
            </legend>
            <label className="flex gap-2 items-center">
              <input type="radio" name="ops-plan-ymode" checked={f.yearlyMode === 'discount'} onChange={() => set('yearlyMode')('discount')} /> Twelve months of the monthly price, less
              <input
                aria-label="Yearly discount, percent"
                className="ui-input ui-num"
                style={{ width: 72 }}
                type="number"
                min={0}
                max={90}
                value={f.discount}
                onChange={set('discount')}
                disabled={f.yearlyMode !== 'discount'}
              />{' '}
              %
            </label>
            <label className="flex gap-2 items-center">
              <input type="radio" name="ops-plan-ymode" checked={f.yearlyMode === 'own'} onChange={() => set('yearlyMode')('own')} /> Its own price
            </label>
            {f.yearlyMode === 'own' ? (
              <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                <Field id="ops-plan-ybase" label="Yearly price, ₹" hint={`For up to ${f.includedUnits} ${UNITS[f.unit]}.`}>
                  {money('yBase', 'ops-plan-ybase')}
                </Field>
                <Field id="ops-plan-yextra" label={`Each extra ${unit} a year, ₹`}>
                  {money('yExtra', 'ops-plan-yextra')}
                </Field>
              </div>
            ) : null}
          </fieldset>
        ) : null}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <Field id="ops-plan-trial" label="Free trial, days" hint="0 for no trial. Up to 90.">
            <input id="ops-plan-trial" className="ui-input ui-num" style={{ maxWidth: 120 }} type="number" min={0} max={90} value={f.trialDays} onChange={set('trialDays')} />
          </Field>
          <Field id="ops-plan-order" label="Order on clor.in" hint="Smaller numbers come first.">
            <input id="ops-plan-order" className="ui-input ui-num" style={{ maxWidth: 120 }} type="number" min={0} value={f.displayOrder} onChange={set('displayOrder')} />
          </Field>
        </div>
        <div className="grid gap-2">
          <label className="flex gap-2">
            <input type="checkbox" checked={f.showOnWebsite} onChange={set('showOnWebsite')} /> Show on clor.in
          </label>
          <label className="flex gap-2">
            <input type="checkbox" checked={f.highlight} onChange={set('highlight')} /> Highlight it on clor.in
          </label>
          <label className="flex gap-2">
            <input type="checkbox" checked={f.gstApplies} onChange={set('gstApplies')} /> Add GST to it once CLOR charges GST
          </label>
        </div>
      </form>
    </WsDrawer>
  );
}

/* -------------------------------------------------------------- preview */
function Preview({ plans, catalogue }) {
  const [period, setPeriod] = useState('MONTHLY');
  const [users, setUsers] = useState(3);
  const [employees, setEmployees] = useState(15);
  const [picked, setPicked] = useState([]);
  const [r, setR] = useState(null);
  const codes = useMemo(() => plans.map((p) => p.code), [plans]);
  /* By default the first plan of each app family, so a quote never carries an app twice. */
  const chosen = picked.filter((c) => codes.includes(c));
  useEffect(() => {
    if (!plans.length) return undefined;
    let live = true;
    const t = setTimeout(() => {
      opsPricePreview({ plans, quote: { plans: chosen.length ? chosen : undefined, period, users: Number(users) || 0, employees: Number(employees) || 0 } })
        .then((x) => live && setR(x))
        .catch((e) => live && setR({ problems: [String(e?.message || e)], cards: [] }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [plans, chosen.join(','), period, users, employees]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!plans.length)
    return (
      <Panel title="Preview">
        <p className="ws-card-blurb">Add a plan to see it as clor.in will show it.</p>
      </Panel>
    );
  return (
    <>
      <Panel title="On clor.in">
        {!r ? (
          <p className="ws-card-blurb">Working it out…</p>
        ) : r.problems?.length ? (
          <p className="ws-card-blurb">The preview shows once the plans are complete: {r.problems[0]}</p>
        ) : (
          <ul className="ws-list">
            {r.cards.map((c) => {
              const p = period === 'YEARLY' ? c.yearly : c.monthly;
              return (
                <li key={c.code} className="grid gap-1" style={{ padding: '10px 0' }}>
                  <span className="font-medium">
                    {c.name}
                    {c.highlight ? (
                      <span className="ws-pill" style={{ marginLeft: 8 }}>
                        Highlighted
                      </span>
                    ) : null}
                  </span>
                  <span className="ui-num" style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                    {p ? inr(p.basePrice) : '—'}
                    <span className="ws-item-sub"> {p ? (period === 'YEARLY' ? 'a year' : 'a month') : 'not offered'}</span>
                  </span>
                  <span className="ws-item-sub">
                    {appNames(c.apps, catalogue)} · up to {c.includedUnits} {UNITS[c.unit]}
                    {p?.extraUnitPrice ? `, then ${inr(p.extraUnitPrice)} a ${UNIT[c.unit]}` : ''}
                    {c.trialDays ? ` · ${c.trialDays}-day free trial` : ''}
                  </span>
                </li>
              );
            })}
            {r.hidden?.length ? (
              <li className="ws-item-sub" style={{ padding: '10px 0' }}>
                Not shown: {r.hidden.join(', ')}
              </li>
            ) : null}
          </ul>
        )}
        <div className="flex gap-2" role="group" aria-label="Period">
          {['MONTHLY', 'YEARLY'].map((p) => (
            <button key={p} type="button" className={`ws-btn ws-btn--small ${period === p ? 'ws-btn--primary' : 'ws-btn--quiet'}`} aria-pressed={period === p} onClick={() => setPeriod(p)}>
              {p === 'MONTHLY' ? 'Monthly' : 'Yearly'}
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Sample quote">
        <fieldset className="grid gap-1">
          <legend className="text-sm font-medium" style={{ marginBottom: 4 }}>
            Plans
          </legend>
          {plans.map((p) => (
            <label key={p.code} className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={chosen.includes(p.code) || (!chosen.length && p.code === codes[0])}
                onChange={() =>
                  setPicked((s) => {
                    const base = s.length ? s : [codes[0]];
                    return base.includes(p.code) ? base.filter((x) => x !== p.code) : [...base, p.code];
                  })
                }
              />{' '}
              {p.name || p.code}
            </label>
          ))}
        </fieldset>
        <div className="flex gap-3">
          <label className="grid gap-1 text-sm">
            Users
            <input className="ui-input ui-num" style={{ width: 88 }} type="number" min={0} value={users} onChange={(e) => setUsers(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            Employees
            <input className="ui-input ui-num" style={{ width: 88 }} type="number" min={0} value={employees} onChange={(e) => setEmployees(e.target.value)} />
          </label>
        </div>
        {r?.quoteError ? <p className="ws-card-blurb">{r.quoteError}</p> : null}
        {r?.quote ? (
          <table className="ws-table" style={{ fontSize: '0.8125rem' }}>
            <caption className="sr-only">Sample quote</caption>
            <tbody>
              {r.quote.lines.map((l) => (
                <tr key={l.planCode}>
                  <td style={{ whiteSpace: 'normal', paddingInline: 0 }}>
                    {l.planName}
                    <div className="ws-item-sub">
                      {l.quantity} {UNITS[l.unit]}
                      {l.extraUnits ? `, ${l.extraUnits} extra` : ''}
                    </div>
                  </td>
                  <td className="num" style={{ paddingInline: 0 }}>
                    {inr(l.amount)}
                  </td>
                </tr>
              ))}
              {r.quote.yearlySaving ? (
                <tr>
                  <td style={{ paddingInline: 0 }}>Saved on monthly</td>
                  <td className="num" style={{ paddingInline: 0 }}>
                    {inr(r.quote.yearlySaving)}
                  </td>
                </tr>
              ) : null}
              <tr>
                <td style={{ paddingInline: 0 }}>GST</td>
                <td className="num" style={{ paddingInline: 0 }}>
                  {inr(r.quote.tax.amount)}
                </td>
              </tr>
              <tr>
                <td className="font-medium" style={{ paddingInline: 0 }}>
                  Total {period === 'YEARLY' ? 'a year' : 'a month'}
                </td>
                <td className="num font-medium" style={{ paddingInline: 0 }}>
                  {inr(r.quote.total)}
                </td>
              </tr>
            </tbody>
          </table>
        ) : null}
        {r?.gst ? <p className="ws-card-blurb">{r.gst.note}</p> : null}
      </Panel>
    </>
  );
}
