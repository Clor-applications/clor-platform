import React, { Suspense, lazy, useMemo, useState } from 'react';
import { useDismissable } from '@ui/components/ui/useDismissable';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  LayoutList,
  MoreHorizontal,
  PackageSearch,
  Plus,
  ReceiptText,
  Undo2,
  Wallet,
} from 'lucide-react';

import { formatMoney, formatMoneyCompact } from '@ui/utils/money';
import { getVendorDisplayName } from '@ui/utils/contacts';
import { MoneyValue } from '@ui/components/docs';
import {
  EmptyPanel,
  OverviewStatusPill as StatusPill,
  Panel,
  PanelLink,
  Segmented,
  buildPeriods,
  iso,
  parseIso,
  prettyDate,
} from '../overview/OverviewParts';
import { PermissionButton } from '@ui/permissions/ActionGuard';

const LazySeriesBars = lazy(() =>
  import('@ui/components/charts/CircularCharts').then((m) => ({ default: m.SeriesBars }))
);
const LazyDonutChart = lazy(() =>
  import('@ui/components/charts/CircularCharts').then((m) => ({ default: m.DonutChart }))
);

const ChartFallback = ({ height = 260 }) => (
  <div className="ui-skel rounded-xl" style={{ height }} aria-hidden="true" />
);

const metricTones = {
  blue: { ink: '#3b82f6', soft: '#3b82f61f' },
  green: { ink: '#10b981', soft: '#10b9811f' },
  amber: { ink: '#f59e0b', soft: '#f59e0b1f' },
  red: { ink: '#fb7185', soft: '#fb71851f' },
  violet: { ink: '#8b5cf6', soft: '#8b5cf61f' },
};

/* Ageing buckets: current, then overdue, then badly overdue — tints of the status tokens, so both themes read. */
const agingTone = (index) => {
  const tone = index === 0 ? 'var(--pos)' : index < 3 ? 'var(--warn-ink, 180 83 9)' : 'var(--neg)';
  return { borderColor: `rgb(${tone} / 0.4)`, backgroundColor: `rgb(${tone} / 0.08)` };
};

function PurchaseMetricCard({ icon: Icon, label, value, delta, goodWhenUp = true, tone = 'blue', series = [] }) {
  const palette = metricTones[tone] || metricTones.blue;
  const rising = Number(delta) > 0;
  const good = goodWhenUp ? rising : !rising;
  const points = (() => {
    if (!series.length) return '';
    const min = Math.min(...series, 0);
    const max = Math.max(...series, 1);
    const span = Math.max(1, max - min);
    return series.map((entry, index) => `${series.length === 1 ? 50 : index / (series.length - 1) * 100},${28 - ((entry - min) / span) * 24}`).join(' ');
  })();

  return (
    <article className="ui-card min-w-0 p-3.5" aria-label={label}>
      <div className="flex items-center gap-2 text-xs font-semibold ui-muted">
        <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ backgroundColor: palette.soft, color: palette.ink }}><Icon size={15} /></span>
        {label}
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_5rem] items-end gap-2">
        <div className="min-w-0"><p className="ui-money truncate text-xl font-bold" title={String(value)}>{value}</p><div className="mt-1 text-[11px]"><span style={{ color: good ? 'rgb(var(--pos))' : 'rgb(var(--neg))' }}>{rising ? '↑' : '↓'} {Math.abs(Number(delta || 0)).toFixed(1)}%</span> <span className="ui-subtle">vs previous period</span></div></div>
        <svg viewBox="0 0 100 32" className="h-9 w-full" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} fill="none" stroke={palette.ink} strokeWidth="2" vectorEffect="non-scaling-stroke" /><polyline points={`0,32 ${points} 100,32`} fill={palette.ink} fillOpacity=".08" stroke="none" /></svg>
      </div>
    </article>
  );
}

function PurchaseEmptyState({ height, title, detail, action, icon: Icon = PackageSearch }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 text-center"
      style={{ minHeight: height, borderColor: 'rgb(var(--line))', backgroundColor: 'rgb(var(--surface-sunken))' }}
    >
      <span
        className="mb-3 grid h-12 w-12 place-items-center rounded-2xl"
        style={{ backgroundColor: 'rgb(var(--ov-blue-soft))', color: 'rgb(var(--ov-blue))' }}
        aria-hidden="true"
      >
        <Icon size={23} strokeWidth={1.7} />
      </span>
      <p className="text-sm font-semibold">{title}</p>
      {detail ? <p className="mt-1 max-w-sm text-xs leading-5 ui-muted">{detail}</p> : null}
      {action ? (
        <button type="button" onClick={action.onClick} className="ui-btn ui-btn-secondary mt-3">
          <Plus size={15} aria-hidden="true" /> {action.label}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The Purchases module's front page.
 *
 * It shipped as a placeholder — "statistics will appear here" — beside a Sales
 * overview that had six figures, two charts and the recent documents of each
 * kind. Somebody who had learnt to read one module could not read the other,
 * which is the inconsistency people notice first.
 *
 * It is the same page asking the mirror question. Sales asks what came in and
 * how much of it has been collected; this asks what went out and how much of
 * it has been paid. The furniture is shared (`../overview/OverviewParts`); the
 * figures are not, because a bill is a liability and an invoice is not.
 */
export default function PurchaseOverview({ db, currentCompany, onNavigate, onNewBill }) {
  const [nowTs] = useState(() => Date.now());
  const periods = useMemo(() => buildPeriods(nowTs), [nowTs]);
  const [periodKey, setPeriodKey] = useState('thisMonth');
  const [periodOpen, setPeriodOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  /* Both close on a click anywhere else, and on Escape. Neither did: the only
     way to put one away was to click the button that opened it again. */
  const periodRef = useDismissable(periodOpen, () => setPeriodOpen(false));
  const moreRef = useDismissable(moreOpen, () => setMoreOpen(false));
  const [grain, setGrain] = useState('daily');
  const breakdownBy = 'item';

  const period = periods.find((p) => p.key === periodKey) || periods[0];
  const money = (v) => formatMoney(v, currentCompany);
  const go = (screen) => {
    if (typeof onNavigate === 'function') onNavigate(screen);
  };

  const allBills = useMemo(
    () => (Array.isArray(db?.bills) ? db.bills : []).filter((b) => b.companyId === currentCompany?.id),
    [db?.bills, currentCompany?.id]
  );
  const allDebitNotes = useMemo(
    () => (Array.isArray(db?.debitNotes) ? db.debitNotes : []).filter((d) => d.companyId === currentCompany?.id),
    [db?.debitNotes, currentCompany?.id]
  );

  const inRange = (v, from, to) => {
    const d = String(v || '').slice(0, 10);
    return Boolean(d) && d >= from && d <= to;
  };

  /**
   * Every headline figure, for a range.
   *
   * Drafts are out of the money and in the count, the same rule the Sales page
   * follows: a draft bill is a piece of paper on somebody's desk, not a debt.
   * Run twice — the chosen period and the one before it — which is what makes
   * every delta on this page a comparison rather than a decoration.
   */
  const summarise = (from, to) => {
    const rows = allBills.filter((b) => inRange(b.date, from, to));
    const live = rows.filter((b) => {
      const st = String(b.status || '').toLowerCase();
      return st !== 'draft' && st !== 'cancelled';
    });
    const today = iso(new Date(nowTs));
    let purchases = 0;
    let paid = 0;
    let payable = 0;
    let overdue = 0;
    for (const bill of live) {
      const total = Number(bill.total || 0);
      const settled = Number(bill.paidAmount || 0);
      /* Net of the bill's own source TDS — that slice is the department's. */
      const bal = Math.max(0, total - Number(bill.tdsAmount || 0) - settled);
      purchases += total;
      paid += settled;
      payable += bal;
      const due = String(bill.dueDate || '').slice(0, 10);
      if (bal > 0 && due && due < today) overdue += bal;
    }
    const notes = allDebitNotes.filter((d) => inRange(d.date, from, to));
    return {
      purchases,
      count: rows.length,
      paid,
      payable,
      overdue,
      returned: notes.reduce((t, d) => t + Number(d.total || 0), 0),
      returnedCount: notes.length,
      rows,
    };
  };

  const current = useMemo(
    // summarise closes over the same inputs the memo lists.
    () => summarise(period.from, period.to),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allBills, allDebitNotes, period.from, period.to, nowTs]
  );
  const previous = useMemo(
    () => summarise(period.prev.from, period.prev.to),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allBills, allDebitNotes, period.prev.from, period.prev.to, nowTs]
  );

  const activeVendorCount = useMemo(
    () => new Set(current.rows.filter((bill) => !['draft', 'cancelled'].includes(String(bill.status || '').toLowerCase())).map((bill) => String(bill.vendorId || bill.vendorName || '')).filter(Boolean)).size,
    [current.rows]
  );
  const previousActiveVendorCount = useMemo(
    () => new Set(previous.rows.filter((bill) => !['draft', 'cancelled'].includes(String(bill.status || '').toLowerCase())).map((bill) => String(bill.vendorId || bill.vendorName || '')).filter(Boolean)).size,
    [previous.rows]
  );

  /** Percentage change, or null when there is no baseline to compare against. */
  const delta = (now, before) => {
    if (!Number.isFinite(before) || before === 0) return null;
    return ((now - before) / Math.abs(before)) * 100;
  };

  /**
   * The series behind the spend chart.
   *
   * Paid is counted against the bill's own date rather than the day the money
   * left, because this page is about what a period cost and how much of that
   * period's cost has been settled.
   */
  const performance = useMemo(() => {
    const from = parseIso(period.from);
    const to = parseIso(period.to);
    if (!from || !to) return [];

    const keyOf = (d) => {
      if (grain === 'daily') return iso(d);
      if (grain === 'weekly') {
        const s = new Date(d);
        s.setDate(s.getDate() - s.getDay());
        return iso(s);
      }
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    const labelOf = (d) =>
      grain === 'monthly'
        ? d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
        : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

    const buckets = new Map();
    const cursor = new Date(from);
    // A bucket per period in range, so a month with no bills draws a gap rather
    // than being silently skipped.
    let guard = 0;
    while (cursor <= to && guard < 400) {
      const k = keyOf(cursor);
      if (!buckets.has(k)) buckets.set(k, { key: k, label: labelOf(cursor), billed: 0, paid: 0, payable: 0 });
      if (grain === 'daily') cursor.setDate(cursor.getDate() + 1);
      else if (grain === 'weekly') cursor.setDate(cursor.getDate() + 7);
      else cursor.setMonth(cursor.getMonth() + 1);
      guard += 1;
    }

    for (const bill of current.rows) {
      const st = String(bill.status || '').toLowerCase();
      if (st === 'draft' || st === 'cancelled') continue;
      const d = parseIso(bill.date);
      if (!d) continue;
      const b = buckets.get(keyOf(d));
      if (!b) continue;
      const total = Number(bill.total || 0);
      const settled = Number(bill.paidAmount || 0);
      b.billed += total;
      b.paid += settled;
      b.payable += Math.max(0, total - Number(bill.tdsAmount || 0) - settled);
    }
    return [...buckets.values()];
  }, [current.rows, grain, period.from, period.to]);

  /** Who or what the period's spend went on, top four and a tail. */
  const breakdown = useMemo(() => {
    const totals = new Map();
    const live = current.rows.filter((b) => {
      const st = String(b.status || '').toLowerCase();
      return st !== 'draft' && st !== 'cancelled';
    });

    if (breakdownBy === 'vendor') {
      const byId = new Map((db?.vendors || []).map((v) => [String(v.id), v]));
      for (const bill of live) {
        const name = getVendorDisplayName(byId.get(String(bill.vendorId))) || bill.vendorName || 'Unnamed vendor';
        totals.set(name, (totals.get(name) || 0) + Number(bill.total || 0));
      }
    } else {
      const byId = new Map((db?.items || []).map((i) => [String(i.id), i]));
      for (const bill of live) {
        for (const l of Array.isArray(bill.items) ? bill.items : []) {
          const name = byId.get(String(l.itemId))?.category || 'Uncategorised';
          const amount = Number(l.lineTotal ?? l.amount ?? Number(l.quantity || 0) * Number(l.rate || 0));
          totals.set(name, (totals.get(name) || 0) + amount);
        }
      }
    }

    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const palette = ['ov-blue', 'ov-green', 'ov-amber', 'ov-violet'];
    const top = sorted.slice(0, 4).map(([name, value], i) => ({
      name,
      value,
      color: `rgb(var(--${palette[i % palette.length]}))`,
    }));
    const tail = sorted.slice(4).reduce((t, [, v]) => t + v, 0);
    if (tail > 0) top.push({ name: 'Everything else', value: tail, color: 'rgb(var(--fg-subtle))' });
    return top;
  }, [current.rows, breakdownBy, db?.vendors, db?.items]);

  const breakdownTotal = breakdown.reduce((t, r) => t + r.value, 0);

  /**
   * Why a panel is empty, when the book is not.
   *
   * "Nothing bought in this period" is true and useless if there are two years
   * of bills a window away; the reason and the way to them is one button.
   */
  const emptyReason = useMemo(() => {
    if (!allBills.length) {
      return {
        title: 'No bills yet',
        detail: 'A bill is what a vendor has charged you. Enter one and this page starts answering.',
        action: { label: 'Enter a bill', onClick: () => (typeof onNewBill === 'function' ? onNewBill() : go('bills')) },
      };
    }
    const newest = allBills
      .map((b) => String(b.date || '').slice(0, 10))
      .filter(Boolean)
      .sort()
      .pop();
    return {
      title: 'Nothing bought in this period',
      detail: newest ? `The most recent bill is dated ${prettyDate(newest)}.` : '',
      action: { label: 'See all bills', onClick: () => go('bills') },
    };
  }, [allBills, onNewBill]);

  const payables = useMemo(() => {
    const today = parseIso(iso(new Date(nowTs)));
    const buckets = [
      { key: 'current', label: 'Current', from: -Infinity, to: 0 },
      { key: 'd30', label: '1–30 days', from: 1, to: 30 },
      { key: 'd60', label: '31–60 days', from: 31, to: 60 },
      { key: 'd90', label: '61–90 days', from: 61, to: 90 },
      { key: 'd120', label: '91–120 days', from: 91, to: 120 },
      { key: 'd120plus', label: '> 120 days', from: 121, to: Infinity },
    ].map((bucket) => ({ ...bucket, amount: 0 }));
    const vendors = new Map();
    let total = 0;
    let weightedDays = 0;
    for (const bill of allBills) {
      if (['draft', 'cancelled'].includes(String(bill.status || '').toLowerCase())) continue;
      const balance = Math.max(0, Number(bill.total || 0) - Number(bill.tdsAmount || 0) - Number(bill.paidAmount || 0));
      if (!balance) continue;
      const due = parseIso(String(bill.dueDate || bill.date || '').slice(0, 10));
      const days = due && today ? Math.max(0, Math.floor((today - due) / 86400000)) : 0;
      const bucket = buckets.find((item) => days >= item.from && days <= item.to) || buckets[0];
      bucket.amount += balance;
      total += balance;
      weightedDays += balance * days;
      const vendor = (db?.vendors || []).find((row) => String(row.id) === String(bill.vendorId));
      const name = getVendorDisplayName(vendor) || bill.vendorName || 'Unnamed vendor';
      const existing = vendors.get(name) || { name, total: 0, oldest: 0, buckets: Object.fromEntries(buckets.map((item) => [item.key, 0])) };
      existing.total += balance;
      existing.oldest = Math.max(existing.oldest, days);
      existing.buckets[bucket.key] += balance;
      vendors.set(name, existing);
    }
    const rows = [...vendors.values()].sort((a, b) => b.total - a.total);
    return { buckets, rows, total, overdue: total - buckets[0].amount, vendorCount: rows.length, averageDays: total ? Math.round(weightedDays / total) : 0 };
  }, [allBills, db?.vendors, nowTs]);

  return (
    <div className="space-y-3 rounded-xl p-3">
      {/* The same band Home opens with — see HeroBand. The module names
          itself, and the controls that govern every figure below sit
          where Home keeps its search. */}
      <header className="flex flex-wrap items-start justify-between gap-3 px-0.5">
        <div><h1 className="ui-t-page">Purchase Overview</h1><p className="ui-muted mt-0.5 text-sm">View purchase performance and vendor payables at a glance.</p></div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="relative" ref={periodRef}>
            <button
              type="button"
              onClick={() => setPeriodOpen((v) => !v)}
              className="ui-btn ui-btn-secondary !rounded-xl"
              aria-haspopup="listbox"
              aria-expanded={periodOpen}
            >
              <Calendar size={16} aria-hidden="true" />
              {period.label}{' '}
              <span style={{ color: 'rgb(var(--link))' }}>
                ({prettyDate(period.from)} - {prettyDate(period.to)})
              </span>
              <ChevronDown size={16} aria-hidden="true" />
            </button>
            {periodOpen ? (
              <div className="absolute end-0 mt-1 z-30 ui-card p-1 min-w-[14rem]" role="listbox" aria-label="Period">
                {periods.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    role="option"
                    aria-selected={p.key === periodKey}
                    onClick={() => {
                      setPeriodKey(p.key);
                      setPeriodOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm ui-hover-sunken"
                    style={p.key === periodKey ? { backgroundColor: 'rgb(var(--accent-soft))' } : undefined}
                  >
                    <span>{p.label}</span>
                    <span className="block ui-subtle text-xs">
                      {prettyDate(p.from)} – {prettyDate(p.to)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="relative" ref={moreRef}>
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              className="ui-btn ui-btn-secondary !rounded-xl !px-2"
              aria-label="More options"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
            {moreOpen ? (
              <div className="absolute end-0 mt-1 z-30 ui-card p-1 min-w-[13rem]" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    go('bills');
                    setMoreOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm ui-hover-sunken flex items-center gap-2"
                >
                  <LayoutList size={16} aria-hidden="true" /> All bills
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    go('purchaseOrders');
                    setMoreOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm ui-hover-sunken flex items-center gap-2"
                >
                  <FileText size={16} aria-hidden="true" /> Purchase orders
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {/* The six figures. Payables, overdue and returns read as bad-when-rising,
          so their arrows are coloured by meaning rather than direction. */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <PurchaseMetricCard
          tone="amber"
          icon={ReceiptText}
          label="Total Purchases"
          value={money(current.purchases)}
          delta={delta(current.purchases, previous.purchases)}
          goodWhenUp={false}
          series={performance.map((row) => row.billed)}
        />
        <PurchaseMetricCard
          tone="blue"
          icon={FileText}
          label="Bills"
          value={String(current.count)}
          delta={delta(current.count, previous.count)}
          series={performance.map((row) => row.billed)}
        />
        <PurchaseMetricCard
          tone="red"
          icon={Undo2}
          label="Debit Notes"
          value={String(current.returnedCount)}
          delta={delta(current.returnedCount, previous.returnedCount)}
          series={performance.map((row) => row.payable)}
        />
        <PurchaseMetricCard
          tone="violet"
          icon={Wallet}
          label="Active Vendors"
          value={String(activeVendorCount)}
          delta={delta(activeVendorCount, previousActiveVendorCount)}
          series={performance.map((row) => row.paid)}
        />
      </div>

      <div className="grid gap-4 items-stretch xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel
          title="Purchase Trend"
          className="overflow-hidden"
          control={
            <Segmented
              ariaLabel="Grain"
              value={grain}
              onChange={setGrain}
              options={[
                { value: 'daily', label: 'Daily' },
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
              ]}
            />
          }
        >
          {current.count ? (
            <>
              <Suspense fallback={<ChartFallback height={300} />}>
                <LazySeriesBars
                  data={performance}
                  height={300}
                  series={{ bar1: 'Billed', bar2: 'Paid', line: 'Payable' }}
                  keys={{ bar1: 'billed', bar2: 'paid', line: 'payable' }}
                  formatter={(v) => money(v)}
                />
              </Suspense>
              <div className="flex items-center gap-4 flex-wrap text-xs mt-3">
                {[
                  { label: 'Billed', color: 'rgb(var(--ov-blue))' },
                  { label: 'Paid', color: 'rgb(var(--ov-green))' },
                  { label: 'Payable', color: 'rgb(var(--brand-ink))' },
                ].map((l) => (
                  <span key={l.label} className="inline-flex items-center gap-2 ui-muted">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: l.color }} aria-hidden="true" />
                    {l.label}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <PurchaseEmptyState height={286} icon={BarChart3} {...emptyReason} />
          )}
        </Panel>

        <Panel
          title="Purchases by Category"
          className="overflow-hidden"
        >
          {breakdown.length ? (
            <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] items-center">
              <Suspense fallback={<ChartFallback height={230} />}>
                <LazyDonutChart
                  data={breakdown}
                  height={230}
                  centerLabel="Total Spend"
                  centerValue={formatMoneyCompact(breakdownTotal, currentCompany)}
                  formatter={(v) => money(v)}
                />
              </Suspense>
              <ul className="space-y-2.5">
                {breakdown.map((r) => (
                  <li key={r.name} className="flex items-center justify-between gap-3 text-sm">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: r.color }}
                        aria-hidden="true"
                      />
                      <span className="truncate">{r.name}</span>
                    </span>
                    <span className="flex flex-shrink-0 items-baseline gap-3">
                      <span className="ui-mono">{money(r.value)}</span>
                      <span className="ui-subtle text-xs w-8 text-right">
                        {breakdownTotal > 0 ? Math.round((r.value / breakdownTotal) * 100) : 0}%
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <PurchaseEmptyState height={286} icon={PackageSearch} {...emptyReason} />
          )}
        </Panel>
      </div>

      <Panel title="Vendor Payables (Outstanding)" bodyClass="justify-start" className="">
        <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {payables.buckets.map((bucket, index) => <div key={bucket.key} className="rounded-lg border p-3" style={agingTone(index)}><div className="ui-money text-sm font-semibold">{money(bucket.amount)}</div><div className="ui-caption mt-1">{bucket.label}</div><div className="ui-caption">{payables.total ? Math.round(bucket.amount / payables.total * 100) : 0}% of dues</div></div>)}
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between"><h3 className="ui-t-sec">Top Outstanding Vendors</h3><PanelLink onClick={() => go('vendors')}>View vendors</PanelLink></div>
            {payables.rows.length ? <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'rgb(var(--border))' }}><table className="ui-table w-full text-xs"><thead><tr><th className="ui-th">Vendor</th><th className="ui-th text-end">Total Outstanding</th>{payables.buckets.map((bucket) => <th key={bucket.key} className="ui-th text-end whitespace-nowrap">{bucket.label}</th>)}<th className="ui-th">Action</th></tr></thead><tbody>{payables.rows.slice(0, 8).map((row) => <tr key={row.name} className="border-t"><td className="px-2 py-2 font-medium whitespace-nowrap">{row.name}</td><td className="ui-col-amount px-2 py-2">{money(row.total)}</td>{payables.buckets.map((bucket) => <td key={bucket.key} className="ui-col-amount px-2 py-2">{row.buckets[bucket.key] ? formatMoneyCompact(row.buckets[bucket.key], currentCompany) : '—'}</td>)}<td className="px-2 py-2"><button type="button" className="ui-link" onClick={() => go('vendors')}>Open</button></td></tr>)}</tbody></table></div> : <p className="ui-muted py-8 text-center text-sm">No vendor payables are outstanding.</p>}
          </div>
          <aside className="rounded-lg border p-3" style={{ borderColor: 'rgb(var(--border))' }} aria-label="Payables insights"><h3 className="ui-t-sec">Payables Insights</h3><dl className="mt-3 space-y-3"><div className="flex justify-between gap-2"><dt className="ui-muted text-sm">Total Outstanding</dt><dd className="ui-money text-sm font-semibold">{money(payables.total)}</dd></div><div className="flex justify-between gap-2"><dt className="ui-muted text-sm">Overdue Amount</dt><dd className="ui-money text-sm font-semibold text-[rgb(var(--neg))]">{money(payables.overdue)}</dd></div><div className="flex justify-between gap-2"><dt className="ui-muted text-sm">Vendors Overdue</dt><dd className="text-sm font-semibold">{payables.rows.filter((row) => row.oldest > 0).length} / {payables.vendorCount}</dd></div><div className="flex justify-between gap-2"><dt className="ui-muted text-sm">Weighted Age</dt><dd className="text-sm font-semibold">{payables.averageDays} days</dd></div></dl><button type="button" className="ui-btn ui-btn-secondary mt-4 w-full" onClick={() => go('reports')}>View ageing report</button></aside>
        </div>
      </Panel>
    </div>
  );
}
