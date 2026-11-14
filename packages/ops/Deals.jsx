import React, { useEffect, useMemo, useState } from 'react';
import { notify } from '@ui/components/ui/notify';

import { PageHead } from '../../apps/admin/src/screens/wsKit';
import { APP_NAMES, Empty, Err, Loading, ReasonDrawer, Tabs, day } from './kit';
import { inr } from './money';
import './lists.css';
import { unitName, units } from './CustomPlans';
import { opsDealOptions, opsDealQuote, opsSetDeal, opsSubscriptions } from './api';

/**
 * Paid subscriptions (operator console; server: routes/opsDeals.ts).
 *
 * DealDrawer, from a customer's Subscription tab: a published or custom plan,
 * monthly or yearly, how many, maybe an offer, priced live to the paisa;
 * set from a start date, with the first invoice drafted if asked.
 *
 * Subscriptions, under Money: every customer with a plan, what they pay and
 * when it renews, and the monthly total of what active ones pay.
 */
const PER = { MONTHLY: 'month', YEARLY: 'year' };
const todayIso = () => new Date().toISOString().slice(0, 10);

export function DealDrawer({ open, account, onClose, onDone }) {
  const [opts, setOpts] = useState(null);
  const [error, setError] = useState('');
  const [pick, setPick] = useState('');
  const [period, setPeriod] = useState('MONTHLY');
  const [quantity, setQuantity] = useState('1');
  const [offerCode, setOfferCode] = useState('');
  const [status, setStatus] = useState('active');
  const [trialDays, setTrialDays] = useState('14');
  const [startsOn, setStartsOn] = useState(todayIso());
  const [draftInvoice, setDraftInvoice] = useState(true);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  /* The discount limit when this deal needs a second person (Approvals), else null. */
  const [needs, setNeeds] = useState(null);

  useEffect(() => {
    if (!open) return;
    setError('');
    setQuote(null);
    opsDealOptions(account.id)
      .then((o) => {
        setOpts(o);
        const now = o.current?.planSource ? `${o.current.planSource}:${o.current.planRef}` : '';
        const first = o.plans.find((p) => `${p.source}:${p.ref}` === now) || o.plans.find((p) => p.forThisCustomer) || o.plans[0];
        setPick(first ? `${first.source}:${first.ref}` : '');
      })
      .catch((e) => setError(String(e?.message || e)));
  }, [open, account.id]);

  const plan = useMemo(() => opts?.plans.find((p) => `${p.source}:${p.ref}` === pick) || null, [opts, pick]);
  useEffect(() => {
    if (plan && !(period === 'YEARLY' ? plan.yearly : plan.monthly)) setPeriod(plan.monthly ? 'MONTHLY' : 'YEARLY');
    if (plan && Number(quantity) < 1) setQuantity(String(plan.includedUnits));
  }, [plan, period, quantity]);
  const offers = (opts?.offers || []).filter((o) => (!o.periods.length || o.periods.includes(period)) && (!o.planCodes.length || (plan?.source === 'book' && o.planCodes.includes(plan.ref))));
  useEffect(() => {
    if (offerCode && !offers.some((o) => o.code === offerCode)) setOfferCode('');
  }, [offers, offerCode]);

  /* People carries Attendance, so Attendance does not close when People stays. */
  const closing = plan ? (opts?.current?.apps || []).filter((a) => !plan.apps.includes(a) && !(a === 'attendance' && plan.apps.includes('people'))) : [];
  const q = Number(quantity);
  const body = plan && Number.isInteger(q) && q >= 1 ? { source: plan.source, ref: plan.ref, period, quantity: q, offerCode: offerCode || null } : null;
  const key = JSON.stringify(body);
  useEffect(() => {
    if (!open || !body) return setQuote(null);
    let live = true;
    const t = setTimeout(() => {
      opsDealQuote(account.id, body)
        .then((r) => live && (setQuote(r.deal), setNeeds(r.needsApproval ? r.limit : null), setQuoteError('')))
        .catch((e) => live && (setQuote(null), setQuoteError(String(e?.message || e))));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, account.id]);

  const ready = Boolean(quote) && (status === 'active' || Number(trialDays) >= 1);
  const confirm = async (reason) => {
    const r = await opsSetDeal(account.id, { ...body, status, trialDays: status === 'trialing' ? Number(trialDays) : null, startsOn, draftInvoice: status === 'active' && draftInvoice, reason });
    if (r?.needsApproval) notify.success(`Sent for approval. ${account.name} moves to ${quote.plan.name} when a colleague approves it in Approvals.`);
    else if (r?.invoiceProblem) notify.info(`${account.name} is on ${quote.plan.name}. ${r.invoiceProblem}`);
    else notify.success(r.invoiceId ? `${account.name} is on ${quote.plan.name}. The first invoice is drafted in Invoices.` : `${account.name} is on ${quote.plan.name}.`);
    onDone(r);
  };

  const book = opts?.plans.filter((p) => p.source === 'book') || [];
  const custom = opts?.plans.filter((p) => p.source === 'custom') || [];
  return (
    <ReasonDrawer
      open={open}
      title="New subscription"
      what={`Puts ${account.name} on a plan at a price: its apps open for every company they have, and the plan replaces whatever they had. They pay each invoice online, by UPI or by bank transfer.`}
      confirmLabel={needs != null && quote ? 'Ask for approval' : 'Set subscription'}
      ready={ready}
      onClose={onClose}
      onConfirm={confirm}
    >
      <Err>{error}</Err>
      {!opts && !error ? <Loading /> : null}
      {opts && !opts.plans.length ? (
        <p className="ws-card-blurb">No plans to sell yet: publish a price list under Pricing, or make a custom plan.</p>
      ) : null}
      {opts && opts.plans.length ? (
        <>
          <div className="grid gap-1">
            <label htmlFor="deal-plan" className="text-sm font-medium">Plan</label>
            <select id="deal-plan" className="ui-select" value={pick} onChange={(e) => setPick(e.target.value)} aria-describedby="deal-plan-hint">
              {book.length ? (
                <optgroup label="Price list">
                  {book.map((p) => (
                    <option key={p.ref} value={`book:${p.ref}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {custom.length ? (
                <optgroup label="Custom plans">
                  {custom.map((p) => (
                    <option key={p.ref} value={`custom:${p.ref}`}>
                      {p.name}
                      {p.forThisCustomer ? ` (made for ${account.name})` : ''}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            {plan ? <span id="deal-plan-hint" className="ws-card-blurb">{plan.appNames.join(', ')} · counted by {unitName(plan.unit)} · {units(plan.unit, plan.includedUnits)} included</span> : null}
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Billing</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {['MONTHLY', 'YEARLY'].map((k) => {
                const has = plan && (k === 'YEARLY' ? plan.yearly : plan.monthly);
                return (
                  <label key={k} className="flex items-center gap-2" style={{ opacity: has ? 1 : 0.5 }}>
                    <input type="radio" name="deal-period" checked={period === k} disabled={!has} onChange={() => setPeriod(k)} />
                    {k === 'MONTHLY' ? 'Monthly' : 'Yearly'}
                    {!has ? <span className="ws-item-sub">not sold</span> : null}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-sm font-medium">How many {plan ? unitName(plan.unit) : 'units'}</span>
              <input className="ui-input tabular-nums" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} style={{ maxWidth: 160 }} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-medium">Offer</span>
              <select className="ui-select" value={offerCode} onChange={(e) => setOfferCode(e.target.value)}>
                <option value="">No offer</option>
                {offers.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.code}: {o.words}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Starts</legend>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-2">
                <input type="radio" name="deal-status" checked={status === 'active'} onChange={() => setStatus('active')} />
                Paid from
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="deal-status" checked={status === 'trialing'} onChange={() => setStatus('trialing')} />
                Free trial first, from
              </label>
              <label className="flex items-center gap-2">
                <span className="sr-only">Start date</span>
                <input className="ui-input" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
              </label>
              {status === 'trialing' ? (
                <label className="flex items-center gap-2">
                  <span>for</span>
                  <input className="ui-input tabular-nums" type="number" min={1} max={365} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} style={{ width: 90 }} aria-label="Trial days" />
                  <span>days</span>
                </label>
              ) : null}
            </div>
          </fieldset>
          {closing.length ? (
            <p className="ws-notice" role="status">
              {closing.map((a) => APP_NAMES[a] || a).join(' and ')} will close for {account.name}: {closing.length === 1 ? 'it is' : 'they are'} not in this plan. Their data stays.
            </p>
          ) : null}
          <Err>{quoteError}</Err>
          {quote ? (
            <dl className="ops-facts" aria-label="Price">
              <dt>List price</dt>
              <dd className="tabular-nums">
                {inr(quote.listAmount)} a {PER[quote.period]}
              </dd>
              {quote.offer ? (
                <>
                  <dt>{quote.offer.code}</dt>
                  <dd className="tabular-nums">
                    −{inr(quote.discount)} ({quote.offer.words})
                  </dd>
                </>
              ) : null}
              <dt>Before GST</dt>
              <dd className="tabular-nums">{inr(quote.periodAmount)}</dd>
              <dt>GST</dt>
              <dd className="tabular-nums">{quote.tax.charged ? inr(quote.tax.amount) : 'None yet'}</dd>
              <dt>They pay</dt>
              <dd className="tabular-nums" style={{ fontWeight: 600 }}>
                {inr(quote.total)} a {PER[quote.period]}
              </dd>
            </dl>
          ) : null}
          {needs != null && quote ? (
            <p className="ws-notice" role="status">
              This takes more than {needs}% off the list price, so a second person must approve it. It goes to Approvals, and nothing changes for {account.name} until a colleague approves it.
            </p>
          ) : null}
          {status === 'active' ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draftInvoice} onChange={(e) => setDraftInvoice(e.target.checked)} />
              Draft the first invoice, for you to check and issue
            </label>
          ) : null}
        </>
      ) : null}
    </ReasonDrawer>
  );
}

const STATUS = { active: ['Active', 'ws-pill ws-pill--ok'], trialing: ['Trial', 'ws-pill ws-pill--warn'], past_due: ['Payment due', 'ws-pill ws-pill--danger'], paused: ['Paused', 'ws-pill ws-pill--off'], cancelled: ['Cancelled', 'ws-pill ws-pill--off'] };

export function Subscriptions({ openCustomer }) {
  const [tab, setTab] = useState('active');
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    opsSubscriptions({ status: tab === 'all' ? '' : tab })
      .then((r) => (setD(r), setError('')))
      .catch((e) => setError(String(e?.message || e)));
  }, [tab]);
  const sum = d?.summary;

  /* Export the rows this tab shows, as a spreadsheet. */
  const exportCsv = () => {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Account', 'Account ID', 'Plan', 'Billed', 'Apps', 'Amount (₹, before GST)', 'Renews or trial ends', 'State'].map(cell).join(',')];
    for (const s of d?.subscriptions || []) {
      lines.push(
        [s.name, s.code, s.planName || '', s.interval || '', s.apps.map((a) => APP_NAMES[a] || a).join('; '), s.amount != null ? (s.amount / 100).toFixed(2) : '', (s.status === 'trialing' ? s.trialEndsAt : s.renewsAt) || '', STATUS[s.status]?.[0] || s.status]
          .map(cell)
          .join(','),
      );
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `clor-subscriptions-${tab}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tiles = sum
    ? [
        ['MRR', inr(sum.mrr), 1, `${sum.activeCount ?? 0} active, before GST`],
        ['Past due', String(sum.pastDue), 4, sum.pastDue ? `${inr(sum.pastDueAtRisk)} at risk` : 'Nobody is late', sum.pastDue ? 'warn' : null],
        ['Trials ending this week', String(sum.trialsEndingThisWeek), 3, 'In the next seven days'],
        ['Legacy fail-open', String(sum.legacyFailOpen), 8, sum.legacyFailOpen ? 'Every app, no plan: move to a plan' : 'Every account is on a plan', sum.legacyFailOpen ? 'neg' : null],
      ]
    : [];
  return (
    <>
      <PageHead
        title="Subscriptions"
        description="Plans, apps and renewals, before GST. Change one from the customer’s Subscription tab; customers see the change the next time they load a page."
        actions={
          <button type="button" className="ws-btn ws-btn--quiet" onClick={exportCsv} disabled={!d?.subscriptions?.length}>
            Export
          </button>
        }
      />
      {tiles.length ? (
        <div className="ops-kpis">
          {tiles.map(([label, value, cat, note, state]) => (
            <div key={label} className="ops-kpi" style={{ '--kpi': `var(--cat-${cat})` }}>
              <span className="ops-kpi-chip" aria-hidden="true">
                <span className="ops-kpi-dot" />
              </span>
              <span className="ops-kpi-label">{label}</span>
              <span className="ops-kpi-value" data-state={state || undefined}>
                {value}
              </span>
              <span className="ops-kpi-note">{note}</span>
            </div>
          ))}
        </div>
      ) : null}
      <Tabs
        label="Which subscriptions"
        value={tab}
        onChange={(t) => {
          setD((v) => (v ? { ...v, subscriptions: null } : v));
          setTab(t);
        }}
        tabs={[
          ['active', 'Active'],
          ['trialing', 'On trial'],
          ['past_due', 'Payment due'],
          ['cancelled', 'Cancelled'],
          ['all', 'All'],
        ]}
      />
      <Err>{error}</Err>
      {!d?.subscriptions ? (
        error ? null : <Loading />
      ) : !d.subscriptions.length ? (
        <Empty>None here.</Empty>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Subscriptions</caption>
            <thead>
              <tr>
                <th>Account</th>
                <th className="hidden md:table-cell">Plan</th>
                <th className="hidden lg:table-cell">Apps</th>
                <th className="num hidden sm:table-cell">Amount</th>
                <th className="num hidden sm:table-cell">Renews</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {d.subscriptions.map((s) => (
                <tr key={s.accountId}>
                  <td>
                    <button type="button" className="ws-name-link" onClick={() => openCustomer(s.accountId)}>
                      {s.name}
                    </button>
                    {s.amount != null ? <div className="ws-item-sub sm:hidden tabular-nums">{inr(s.amount)} / {s.interval === 'year' ? 'yr' : 'mo'}</div> : null}
                  </td>
                  <td className="hidden md:table-cell" style={{ whiteSpace: 'normal' }}>
                    {s.planName ? `${s.planName}${s.interval ? ` · ${s.interval === 'year' ? 'yearly' : 'monthly'}` : ''}` : s.status === 'trialing' ? 'Trial' : <span className="ws-item-sub">No price set</span>}
                    {s.quantity && s.unit ? <div className="ws-item-sub">{units(s.unit, s.quantity)}</div> : null}
                  </td>
                  <td className="hidden lg:table-cell" style={{ whiteSpace: 'normal' }}>{s.apps.map((a) => APP_NAMES[a] || a).join(', ') || '—'}</td>
                  <td className="num hidden sm:table-cell">
                    {s.amount != null ? inr(s.amount) : '—'}
                    {s.offerCode && s.amount !== s.listAmount ? <div className="ws-item-sub">{s.offerCode} until {day(s.offerEndsAt) === '—' ? 'they stop' : day(s.offerEndsAt)}</div> : null}
                  </td>
                  <td className="num hidden sm:table-cell">{s.status === 'trialing' ? `Ends ${day(s.trialEndsAt)}` : day(s.renewsAt)}</td>
                  <td>
                    <span className={STATUS[s.status]?.[1] || 'ws-pill'}>{STATUS[s.status]?.[0] || s.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
