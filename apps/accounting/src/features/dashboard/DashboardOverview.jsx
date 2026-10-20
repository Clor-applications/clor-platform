import React, { Suspense, lazy, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  Clock,
  CircleSlash,
  FileText,
  Landmark,
  Minus,
  Package,
  Plus,
  Receipt,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';

import { formatMoney, formatMoneyCompact } from '@ui/utils/money';
import { bookState, setupSteps, BOOK_NEW, BOOK_SETUP } from './bookState';
import { usePermissions } from '@ui/permissions/usePermissions';
import {
  CashFlowPanel,
  DueSplitPanel,
  QuickLinks,
  RecentActivity,
  RevenueExpenses,
  StatCard,
  ThingsToDo,
} from './HomeBoard';
import Illustration from '@ui/components/ui/Illustration';
import HeroBand from '@ui/components/ui/HeroBand';
import HeroArt from '@ui/components/ui/HeroArt';
import ChartCard from '@ui/components/charts/ChartCard';
import { useTilt } from '@ui/components/ui/useTilt';
/**
 * ECharts is ~2 MB unminified and belongs nowhere near first paint. Loading the
 * chart module on demand keeps the initial bundle for the shell and the tables,
 * and the dashboard shows a shaped placeholder for the few hundred milliseconds
 * it takes to arrive.
 */
const CircularCharts = {
  ChartLegend: lazy(() => import('@ui/components/charts/CircularCharts').then((m) => ({ default: m.ChartLegend }))),
  CompositionPie: lazy(() => import('@ui/components/charts/CircularCharts').then((m) => ({ default: m.CompositionPie }))),
  DonutChart: lazy(() => import('@ui/components/charts/CircularCharts').then((m) => ({ default: m.DonutChart }))),
  RadialGauge: lazy(() => import('@ui/components/charts/CircularCharts').then((m) => ({ default: m.RadialGauge }))),
  PeriodBars: lazy(() => import('@ui/components/charts/CircularCharts').then((m) => ({ default: m.PeriodBars }))),
  RankedBars: lazy(() => import('@ui/components/charts/CircularCharts').then((m) => ({ default: m.RankedBars }))),
};
const { ChartLegend, CompositionPie, DonutChart, RadialGauge, PeriodBars, RankedBars } = CircularCharts;

/** Reserves the chart's height so nothing below it jumps when it arrives. */
const ChartFallback = ({ height = 220 }) => (
  <div className="ui-skel w-full" style={{ height, borderRadius: 'var(--radius)' }} aria-hidden="true" />
);
import { PageHeader, EmptyState } from '@ui/components/ui/Primitives';
import {
  cashPosition,
  receivables as receivablesAsOf,
  payables as payablesAsOf,
  gstPosition,
  AGEING_BUCKETS,
} from '@ui/utils/cashPosition';
import { computeInventorySummaryByItemId } from '@ui/utils/inventory';

/**
 * The dashboard.
 *
 * Built around the three questions a proprietor actually opens the books to
 * ask — what did we bill, what have we collected, and who owes us — rather
 * than a grid of every number the database can produce. Each block answers one
 * of them, in that order.
 *
 * The chart and the aging bar are hand-drawn SVG rather than a charting
 * library: both are simple shapes, and a 90 KB dependency for two of them
 * would cost more on first paint than it returns.
 */

const DAY = 86_400_000;


const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};


/** Direction chip. Colour never carries the meaning alone — the arrow does too. */
/**
 * The shape of a number, at table scale.
 *
 * A change of +179% could be a steady climb or one lumpy week, and the
 * percentage cannot tell you which. Twenty-four pixels of line can.
 */
/** Absolute movement, for figures that can be negative on either side. */
function DiffChip({ value, company, invert = false }) {
  const v = Math.round(value);
  if (v === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium" style={{ color: 'rgb(var(--fg-muted))' }}>
        <Minus size={14} aria-hidden="true" />
        Flat
      </span>
    );
  }
  const rose = v > 0;
  const good = invert ? !rose : rose;
  const Icon = rose ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className="inline-flex items-center gap-1 text-sm font-medium"
      style={{ color: good ? 'rgb(var(--pos))' : 'rgb(var(--neg))' }}
    >
      <Icon size={14} aria-hidden="true" />
      {formatMoney(Math.abs(v), company)}
    </span>
  );
}

/** Difference between two rates, in points — never as a percentage of itself. */
function PointsChip({ value, invert = false }) {
  const v = Math.round(value);
  if (v === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium" style={{ color: 'rgb(var(--fg-muted))' }}>
        <Minus size={14} aria-hidden="true" />
        Flat
      </span>
    );
  }
  const rose = v > 0;
  const good = invert ? !rose : rose;
  const Icon = rose ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className="inline-flex items-center gap-1 text-sm font-medium"
      style={{ color: good ? 'rgb(var(--pos))' : 'rgb(var(--neg))' }}
    >
      <Icon size={14} aria-hidden="true" />
      {Math.abs(v)} pts
    </span>
  );
}

function MiniSpark({ series = [] }) {
  const path = useMemo(() => {
    if (series.length < 2) return '';
    const max = Math.max(...series, 1);
    const step = 100 / (series.length - 1);
    return series
      .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(2)} ${(20 - (v / max) * 18).toFixed(2)}`)
      .join(' ');
  }, [series]);

  if (!path) return null;
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="h-5 w-full" aria-hidden="true">
      <path d={path} fill="none" stroke="rgb(var(--brand))" strokeWidth="1.75" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function DeltaChip({ value, invert = false }) {
  if (value === null) {
    return <span className="ui-badge ui-badge-neutral">New</span>;
  }

  const rounded = Math.round(value * 10) / 10;
  const flat = Math.abs(rounded) < 0.1;
  // Two independent things, and they must not be conflated: the arrow shows
  // which way the number moved, the colour says whether that is welcome. A
  // rise in money owed points UP and is coloured bad — showing a down arrow
  // for it, as this did, reads as "outstanding fell" when it doubled.
  const rose = rounded > 0;
  const good = invert ? !rose : rose;
  const Icon = flat ? Minus : rose ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className="inline-flex items-center gap-1 text-sm font-medium"
      style={{ color: flat ? 'rgb(var(--fg-muted))' : good ? 'rgb(var(--pos))' : 'rgb(var(--neg))' }}
    >
      <Icon size={14} aria-hidden="true" />
      {flat ? 'Flat' : `${Math.abs(rounded)}%`}
    </span>
  );
}

/**
 * KPI card.
 *
 * Small title, large number, tiny trend, sparkline, one action. Deliberately
 * no icon: an icon beside "Billed" tells the reader nothing the word did not,
 * and four of them across a row is decoration competing with the figures.
 *
 * The figure is neutral, not coloured. Colour on the number would say the
 * amount itself is good or bad; only the movement can carry that, so only the
 * trend chip is tinted.
 */
/**
 * A balance card: what is true right now.
 *
 * Distinct from MetricCard, which reports a flow over the selected period.
 * The distinction is on the card itself — "as of today" — because the period
 * control sits directly above these and would otherwise appear to govern them.
 */
function BalanceCard({ label, value, company, tone = '', hint, note, accent, actionLabel, onAction, children }) {
  const rail = { neg: 'var(--neg)', warn: 'var(--warn)', pos: 'var(--pos)', brand: 'var(--brand)' }[accent];
  return (
    <div className="ui-card p-4 flex flex-col gap-1 relative overflow-hidden">
      {rail ? (
        <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: `rgb(${rail})` }} />
      ) : null}
      <div className={`flex items-baseline justify-between gap-2 ${rail ? 'pl-1' : ''}`}>
        <span className="ui-card-label">{label}</span>
        <span className="ui-subtle text-xs">as of today</span>
      </div>
      <div
        className={`ui-mono tabular-nums text-[1.55rem] leading-9 ${rail ? 'pl-1' : ''}`}
        style={tone ? { color: `rgb(var(--${tone}))` } : undefined}
      >
        {value === null ? <span className="ui-subtle font-normal">—</span> : formatMoney(value, company)}
      </div>
      {hint ? <div className={`ui-subtle text-xs ${rail ? 'pl-1' : ''}`}>{hint}</div> : null}
      {note ? (
        <div className={`text-xs font-medium ${rail ? 'pl-1' : ''}`} style={{ color: `rgb(var(--${tone || 'fg-muted'}))` }}>
          {note}
        </div>
      ) : null}
      {children ? <div className={rail ? 'pl-1' : ''}>{children}</div> : null}
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className={`ui-btn ui-btn-ghost ui-btn-sm self-start mt-auto pt-2 !px-0 ${rail ? 'ml-1' : ''}`}
          style={{ color: 'rgb(var(--brand-ink))' }}
        >
          {actionLabel} <ArrowRight size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** The ageing bar. A stacked bar, never a pie: proportion off a bar is read, off a pie it is guessed. */
function AgeingBar({ buckets, total, company, onPick }) {
  /**
   * Cool to warm as the debt ages, in five distinguishable steps: pine, pale
   * amber, amber, pale red, red. Two of them used to be the brand and a
   * hardcoded `234 88 12` — orange-600, a literal left behind when the brand
   * stopped being orange, and the only colour in this file outside the tokens.
   * The pale steps are the same token at reduced alpha rather than new hues,
   * so the ramp cannot drift from the semantics it sits beside.
   */
  const tones = {
    pos: 'rgb(var(--brand))',
    warn: 'rgb(var(--warn) / 0.55)',
    warn2: 'rgb(var(--warn))',
    neg2: 'rgb(var(--neg) / 0.6)',
    neg: 'rgb(var(--neg))',
  };
  if (total <= 0) return null;
  return (
    <div className="mt-2">
      <div className="flex h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgb(var(--surface-sunken))' }}>
        {AGEING_BUCKETS.map((b) => {
          const amt = buckets[b.key] || 0;
          if (amt <= 0) return null;
          return (
            <span
              key={b.key}
              style={{ width: `${(amt / total) * 100}%`, backgroundColor: tones[b.tone] }}
      title={`${b.label} — ${formatMoney(amt, company)}`}
            />
          );
        })}
      </div>
      {/*
        Every bucket, not only the ones with money in them.
        The legend used to filter to non-zero, so a book with one invoice
        showed a single chip and left the panel three-quarters empty beside two
        siblings full of content. A blank bucket is also the answer to a
        question — "is anything ninety days late?" — and it takes a row to say
        no. Read down, this is the shape of the receivable book.
      */}
      <div className="mt-3" style={{ borderTop: '1px solid rgb(var(--border))' }}>
        {AGEING_BUCKETS.map((b) => {
          const amt = Number(buckets[b.key] || 0);
          return (
            <button
              key={b.key}
              type="button"
              onClick={onPick && amt > 0 ? () => onPick(b) : undefined}
              className="w-full flex items-center gap-2 py-1.5 text-start"
              style={{
                borderBottom: '1px solid rgb(var(--border))',
                background: 'none',
                cursor: onPick && amt > 0 ? 'pointer' : 'default',
              }}
            >
              <span
                className="inline-block w-2 h-2 rounded-sm shrink-0"
                style={{ backgroundColor: amt > 0 ? tones[b.tone] : 'rgb(var(--border-strong))' }}
                aria-hidden="true"
              />
              <span className="ui-t-body" style={{ color: amt > 0 ? 'rgb(var(--fg))' : 'rgb(var(--fg-subtle))' }}>
                {b.label}
              </span>
              <span
                className="ms-auto ui-mono text-sm"
                style={{ color: amt > 0 ? 'rgb(var(--fg))' : 'rgb(var(--fg-subtle))', fontWeight: amt > 0 ? 500 : 400 }}
              >
                {amt > 0 ? formatMoney(amt, company) : '—'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MetricCard({ label, value, company, deltaValue, invertDelta, hint, series = [], actionLabel, onAction }) {
  // Three degrees, no more: the figure lifts 18px above the card so the
  // number — the point of the tile — is what the depth showcases.
  const { ref: tiltRef, onPointerMove: tiltMove, onPointerLeave: tiltLeave } = useTilt({ maxDeg: 3, scale: 1.008 });

  const path = useMemo(() => {
    if (series.length < 2) return '';
    const max = Math.max(...series, 1);
    const step = 100 / (series.length - 1);
    return series
      .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(2)} ${(24 - (v / max) * 22).toFixed(2)}`)
      .join(' ');
  }, [series]);

  return (
    <article
      ref={tiltRef}
      onPointerMove={tiltMove}
      onPointerLeave={tiltLeave}
      className="ui-tilt3d ui-card ui-hover-raise p-6 flex flex-col"
    >
      <h3 className="ui-card-label">{label}</h3>

      {/* Compact at a glance; the exact figure is one hover away and lives in
          full in the tables below. */}
      <p className="ui-kpi ui-depth-1 mt-3" title={formatMoney(value, company)}>
        {formatMoneyCompact(value, company)}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <DeltaChip value={deltaValue} invert={invertDelta} />
        {hint ? <span className="ui-caption truncate">{hint}</span> : null}
      </div>

      {path ? (
        <svg
          className="mt-5 w-full"
          height="24"
          viewBox="0 0 100 24"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d={path}
            fill="none"
            stroke="rgb(var(--brand))"
            strokeWidth="1.5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}

      {actionLabel ? (
        <button type="button" onClick={onAction} className="ui-card-action mt-5 self-start">
          {actionLabel}
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      ) : null}
    </article>
  );
}

/** Billed vs collected over time, as two stacked areas. */
function AgingPanel({ buckets, total, company }) {
  const rows = buckets.filter((b) => b.amount > 0).map((b) => ({ name: b.label, value: b.amount, color: b.color }));

  return (
    <section className="ui-card p-5">
      <h2 className="ui-title text-sm">Outstanding by age</h2>
      <p className="ui-subtle text-xs mt-0.5">Where the receivable book is sitting</p>

      {total <= 0 ? (
        <EmptyState icon={CircleSlash} title="Nothing outstanding" description="Every invoice in view is settled." />
      ) : (
        <>
          <Suspense fallback={<ChartFallback height={220} />}>
            <DonutChart
              data={rows}
              centerLabel="Outstanding"
              centerValue={formatMoney(total, company)}
              height={220}
            />
          </Suspense>
          {/* The ring shows shape; these carry the figures it cannot. */}
          <div className="mt-4">
            <Suspense fallback={<ChartFallback height={96} />}>
              <ChartLegend rows={rows} total={total} formatter={(v) => formatMoney(v, company)} />
            </Suspense>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Customer concentration.
 *
 * Ranked bars answer "who owes most"; the share of the whole answers "how
 * exposed are we to one customer", which is the question that changes a
 * decision. Capped at five slices plus an "Other".
 */
function TopCustomers({ rows, company }) {
  return (
    <section className="ui-card p-5">
      <h2 className="ui-title text-sm">Where the money is owed</h2>
      <p className="ui-subtle text-xs mt-0.5">Share of outstanding, by customer</p>

      {rows.length === 0 ? (
        <EmptyState icon={Wallet} title="Nobody owes you" description="Outstanding balances appear here as invoices go unpaid." />
      ) : (
        <div className="mt-4">
          <Suspense fallback={<ChartFallback height={320} />}>
            <CompositionPie
              data={rows.map((r) => ({ name: r.name, value: r.outstanding }))}
              height={220}
              formatter={(v) => formatMoney(v, company)}
            />
          </Suspense>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The opening composition.
 *
 * Avatar, greeting, and one sentence that had to be earned. The sentence
 * rotates through whatever the book actually has to say — overdue money, a
 * filing window, drafts sitting outside receivables — and when there is
 * nothing to say it says nothing rather than inventing a metric. A greeting
 * that finds a crisis every morning stops being read inside a week.
 * ------------------------------------------------------------------ */

const GREETINGS = [
  [5, 'Good morning'],
  [12, 'Good afternoon'],
  [17, 'Good evening'],
];

function greetingFor(hour) {
  let out = 'Good evening';
  for (const [from, label] of GREETINGS) if (hour >= from) out = label;
  if (hour < 5) out = 'Good evening';
  return out;
}

/** First name from the signed-in address; blank rather than a guess. */
function nameFromEmail(email) {
  const local = String(email || '').split('@')[0] || '';
  const first = local.split(/[._-]/)[0] || '';
  if (!first || /^\d+$/.test(first)) return '';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/**
 * Five bars each side of the greeting, breathing out of step.
 *
 * Decoration, and deliberately unreadable as data: they never stop moving, so
 * no bar holds a height long enough to be taken for a measurement. No axis, no
 * label, no hit area, and hidden from assistive tech.
 *
 * Class names written out rather than interpolated — Tailwind tree-shakes
 * `@layer components` rules whose selector never appears literally in the
 * source.
 */
/*
 * The two columns of bars that used to stand behind the greeting are gone.
 * They were drawn from nothing — five fixed heights, no relationship to the
 * book — at the top of a page whose entire job is to report real money. A
 * chart that cannot be read is decoration, and decoration that looks like data
 * is worse than none.
 */

/**
 * What is left to do before the book can be used.
 *
 * This is Home while there is nothing to summarise, rather than a dialog over
 * the top of it. That is not only tidier: the wizard it replaces had to be
 * dismissed, and dismissing it was exactly what made it come back at the next
 * sign-in. A page has no such state to lose.
 */
function SetupChecklist({ steps, onGo }) {
  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;
  const nextKey = steps.find((s) => !s.done && !s.optional)?.key;

  return (
    <section className="ui-card p-4" aria-label="Set up">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="ui-t-sec">Finish setting up</h2>
        <span className="ui-caption">
          {done} of {required.length}
        </span>
      </div>
      <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgb(var(--surface-sunken))' }}>
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.round((done / required.length) * 100)}%`, backgroundColor: 'rgb(var(--brand))' }}
        />
      </div>

      {/* Rows under one hairline, not six cards inside a card. DESIGN.md is
          explicit about it, and the nesting was doing the work a divider does
          at four times the ink. The step being asked for is marked by a rule
          down its start edge rather than by a box around it. */}
      <ul className="mt-3 -mx-4" style={{ borderTop: '1px solid rgb(var(--border))' }}>
        {steps.map((step) => {
          const isNext = step.key === nextKey;
          return (
            <li key={step.key} style={{ borderBottom: '1px solid rgb(var(--border))' }}>
              <button
                type="button"
                onClick={() => onGo?.(step.go)}
                disabled={step.allowed === false}
                className="w-full text-left px-4 py-2.5 flex items-center gap-3 ui-hover-sunken relative disabled:cursor-default"
                style={
                  isNext
                    ? {
                        backgroundColor: 'rgb(var(--accent-soft))',
                        boxShadow: 'inset 3px 0 0 0 rgb(var(--brand))',
                      }
                    : undefined
                }
              >
                <span
                  className="h-6 w-6 rounded-full grid place-items-center text-xs font-medium shrink-0"
                  style={
                    step.done
                      ? { backgroundColor: 'rgb(var(--st-paid-strong))', color: 'rgb(var(--st-paid-ink))' }
                      : isNext
                      ? { backgroundColor: 'rgb(var(--brand))', color: 'rgb(var(--on-brand))' }
                      : { backgroundColor: 'rgb(var(--surface-sunken))', color: 'rgb(var(--fg-subtle))' }
                  }
                  aria-hidden="true"
                >
                  {step.done ? <Check size={14} /> : ''}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">
                    {step.title}
                    {step.optional ? <span className="ui-caption"> — optional</span> : null}
                  </span>
                  <span className="ui-caption block truncate">{step.detail}</span>
                </span>
                {/* The word as well as the ring, so "what is left" does not
                    depend on telling two greys apart. */}
                <span
                  className="ms-auto ui-caption shrink-0"
                  style={step.done || step.allowed === false ? undefined : { color: 'rgb(var(--brand-ink))', fontWeight: 600 }}
                >
                  {step.done ? 'Done' : step.allowed === false ? 'Needs an administrator' : step.cta}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The sentence a mid-setup book needs and never got.
 *
 * With purchases entered and nothing sold, the receivable panels truthfully
 * report nothing outstanding — which reads as "all clear" when it means "you
 * have not billed anyone". Said plainly here so the figures below cannot be
 * misread as good news.
 */
function NothingBilledYet({ payable, stockValue, company, onNewInvoice }) {
  return (
    <section
      className="ui-card p-4 flex items-start gap-3"
      style={{ backgroundColor: 'rgb(var(--st-outstanding-soft))', borderColor: 'rgb(var(--st-outstanding-key) / 0.4)' }}
      aria-label="Nothing billed yet"
    >
      <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: 'rgb(var(--st-outstanding-ink))' }} aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium" style={{ color: 'rgb(var(--st-outstanding-ink))' }}>
          You have not billed anyone yet.
        </p>
        <p className="ui-t-body ui-muted mt-0.5">
          {stockValue > 0 ? `${formatMoney(stockValue, company)} of stock is on hand` : 'Your purchases are recorded'}
          {payable > 0 ? ` and ${formatMoney(payable, company)} is owed to suppliers` : ''}, but the sales ledger is empty — so
          “nothing outstanding” below is the absence of sales, not good news.
        </p>
      </div>
      <button type="button" onClick={onNewInvoice} className="ui-btn ui-btn-primary ms-auto shrink-0">
        Raise the first invoice
      </button>
    </section>
  );
}

/**
 * The head of the page: who you are, the one thing worth knowing, and the
 * ways in.
 *
 * It used to be a centred column — avatar, a 32px serif greeting, the insight,
 * a row of dots, a 50px search bar and a caption under it — roughly 300px of
 * vertical space before a single figure appeared, all of it stacked down the
 * middle. That is the shape of a consumer welcome screen, and it read like
 * one. The avatar was also the second copy on the page; the real one lives in
 * the top bar, where a person's own face belongs.
 *
 * Left-aligned and on three lines now. The greeting and the search share the
 * first, because they are the two things you arrive for; the insight sits
 * under the greeting it qualifies; the actions close it off. Restraint rather
 * than ornament is what reads as considered — and it gives back most of the
 * height to the figures, which is what the page is actually for.
 */
function DashboardHero({ name, insights, actions, dateLabel = '' }) {
  const [idx, setIdx] = useState(0);
  const list = Array.isArray(insights) ? insights.filter(Boolean) : [];
  const active = list.length ? list[Math.min(idx, list.length - 1)] : null;

  return (
    <HeroBand
      /* The greeting is the quiet half and the name is the loud one: two
         lines, not one long sentence trailing off into a name.

         With no name to be loud — a fresh account, or a profile the server
         has not answered for — the greeting becomes the title instead of
         being printed twice, which is what the page did: "Good morning,"
         over "Good morning". */
      eyebrow={name ? `${greetingFor(new Date().getHours())},` : ''}
      title={name || greetingFor(new Date().getHours())}
      art={<HeroArt className="h-full w-full" />}
      subtitle={
        <>
          <p
            className="ui-t-body"
            style={{ color: active ? 'rgb(var(--fg-muted))' : 'rgb(var(--fg-subtle))' }}
            aria-live="polite"
          >
            {active ? active.text : 'Nothing needs you right now.'}
          </p>
          {/* Inline with the sentence they page through, rather than centred
              underneath as an anonymous row of marks. */}
          {list.length > 1 ? (
            <span className="flex items-center gap-1" role="tablist" aria-label="Insights">
              {list.map((it, i) => (
                <button
                  key={it.key}
                  type="button"
                  role="tab"
                  aria-selected={i === idx}
                  aria-label={it.label || `Insight ${i + 1}`}
                  onClick={() => setIdx(i)}
                  /* One property, on the GPU. `transition: all` animating
                     `width` put a layout property on the compositor's critical
                     path for a 10px dot; the dot is a fixed 16px that scales
                     down instead, and only transform and background move. */
                  className="h-1 w-4 origin-left rounded-full"
                  style={{
                    transform: i === idx ? 'scaleX(1)' : 'scaleX(0.375)',
                    transition: 'transform 150ms var(--ease-out), background-color 150ms var(--ease-out)',
                    backgroundColor: i === idx ? 'rgb(var(--brand))' : 'rgb(var(--border-strong))',
                  }}
                />
              ))}
            </span>
          ) : null}
        </>
      }
      /* Search moved to the header, beside the company name, where it is on
         every screen instead of only this one. */
      meta={dateLabel}
      actions={actions}
    />
  );
}

function QuietTiles({ tiles, company }) {
  return (
    <section
      /* Full width, like everything above and below it. It was `mx-auto
         max-w-4xl`, which centred it 128px inside the page — narrower than the
         header over it and the panels under it, aligned to neither, which is
         most of what reads as untidy here. */
      className="mt-6 grid border-s border-t sm:grid-cols-2 lg:grid-cols-3"
      style={{ borderColor: 'rgb(var(--border))' }}
      aria-label="Position"
    >
      {tiles.filter(Boolean).map((t) => (
        <div key={t.label} className="border-e border-b px-5 py-4 text-start" style={{ borderColor: 'rgb(var(--border))' }}>
          <div className="ui-t-body" style={{ color: 'rgb(var(--fg-subtle))' }}>
            {t.label}
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span
              className="ui-money"
              style={{
                fontSize: '1.3125rem',
                lineHeight: '1.75rem',
                fontWeight: 600,
                letterSpacing: '-.01em',
                color: t.value == null ? 'rgb(var(--fg-subtle))' : t.tone ? `rgb(var(--${t.tone}))` : 'rgb(var(--fg))',
              }}
            >
              {t.value == null ? '—' : t.count ? String(t.value) : formatMoney(t.value, company)}
            </span>
            {t.note ? (
              <span className="ui-t-body" style={{ color: 'rgb(var(--fg-subtle))' }}>
                {t.note}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </section>
  );
}

const HOME_TONES = {
  green: { ink: '#10b981', wash: '#ecfdf5' },
  blue: { ink: '#3b82f6', wash: '#eff6ff' },
  red: { ink: '#fb7185', wash: '#fff1f2' },
  violet: { ink: '#8b5cf6', wash: '#f5f3ff' },
};

function HomeMetric({ label, value, company, Icon, tone, change, series }) {
  const palette = HOME_TONES[tone] || HOME_TONES.blue;
  return (
    <section className="ui-card min-w-0 p-3.5" aria-label={label}>
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ color: palette.ink, background: palette.wash }}>
          <Icon size={15} aria-hidden="true" />
        </span>
        <span className="ui-card-label truncate">{label}</span>
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_4.5rem] items-end gap-2">
        <div className="min-w-0">
          <div className="ui-money truncate text-lg font-semibold" title={formatMoney(value, company)}>{formatMoney(value, company)}</div>
          <div className="mt-1 flex items-center gap-1 text-xs" style={{ color: change >= 0 ? 'rgb(var(--pos))' : 'rgb(var(--neg))' }}>
            {change >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            <span>{Math.abs(change || 0)}%</span>
            <span className="ui-subtle">vs last month</span>
          </div>
        </div>
        <div style={{ color: palette.ink }}><MiniSpark series={series} /></div>
      </div>
    </section>
  );
}

function HomePanel({ title, action, children, className = '' }) {
  return (
    <section className={`ui-card min-w-0 p-3.5 ${className}`} aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="ui-t-sec">{title}</h2>
        {action || null}
      </div>
      {children}
    </section>
  );
}

function HomeBars({ rows, peak, company }) {
  return (
    <div>
      <div className="mb-2 flex justify-end gap-3 text-xs">
        <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-[rgb(var(--brand))]" />Income</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-[rgb(var(--warn))]" />Expense</span>
      </div>
      <div className="flex h-32 items-end gap-2">
        {rows.map((row) => (
          <div key={row.key} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <div className="flex flex-1 items-end justify-center gap-1">
              <span className="w-[34%] rounded-t-sm bg-[rgb(var(--brand))]" style={{ height: `${Math.max(row.inAmt ? 3 : 0, row.inAmt / peak * 100)}%` }} title={`Income ${formatMoney(row.inAmt, company)}`} />
              <span className="w-[34%] rounded-t-sm bg-[rgb(var(--warn))]" style={{ height: `${Math.max(row.outAmt ? 3 : 0, row.outAmt / peak * 100)}%` }} title={`Expense ${formatMoney(row.outAmt, company)}`} />
            </div>
            <span className="ui-caption mt-1 text-center">{row.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HomeDoughnut({ rows, total, company }) {
  const colours = ['rgb(var(--brand))', 'rgb(var(--ov-green))', 'rgb(var(--warn))', 'rgb(var(--ov-violet))', 'rgb(var(--fg-subtle))'];
  let cursor = 0;
  const stops = rows.map((row, index) => {
    const start = cursor;
    cursor += total ? row.value / total * 100 : 0;
    return `${colours[index % colours.length]} ${start}% ${cursor}%`;
  });
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-3">
      <div className="relative mx-auto h-28 w-28 rounded-full" style={{ background: rows.length ? `conic-gradient(${stops.join(',')})` : 'rgb(var(--surface-sunken))' }}>
        <div className="absolute inset-[20%] flex flex-col items-center justify-center rounded-full bg-[rgb(var(--surface))] text-center">
          <strong className="ui-money text-sm">{formatMoneyCompact(total, company)}</strong>
          <span className="ui-caption">Total Sales</span>
        </div>
      </div>
      <div className="min-w-0 space-y-2">
        {(rows.length ? rows : [{ label: 'No sales yet', value: 0 }]).map((row, index) => (
          <div key={row.label} className="flex items-center gap-2 text-xs">
            <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: colours[index % colours.length] }} />
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <span className="ui-money">{total ? Math.round(row.value / total * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HomeDueList({ rows, company, empty }) {
  if (!rows.length) return <p className="ui-muted py-6 text-center text-sm">{empty}</p>;
  return (
    <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
      {rows.slice(0, 4).map((row, index) => (
        <li key={`${row.name || row.vendorName}-${index}`} className="flex items-center gap-2 py-2">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--surface-sunken))] text-[10px] font-semibold">
            {String(row.name || row.vendorName || 'NA').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{row.name || row.vendorName}</div>
            <div className="ui-caption truncate">{row.oldest ? `Overdue ${row.oldest} days` : row.due ? `Due ${row.due}` : 'Open balance'}</div>
          </div>
          <span className="ui-money text-sm">{formatMoney(row.amount ?? row.balance, company)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function DashboardOverview({
  db,
  currentCompany,
  onNewInvoice,
  onOpenInvoices,
  invoices: invoicesProp = null,
  activeWarehouseId = '',
  onNewBill = null,
  onRecordReceipt = null,
  onOpenCustomers = null,
  onOpenReports = null,
  userName = '',
  onNavigate = null,
  onOpenCashBank = null,
}) {
  /**
   * Cash and accrual answer different questions and must never be mixed on one
   * screen: accrual says what the business earned, cash says what reached the
   * account. A company can be profitable on one and unable to pay a vendor on
   * the other, which is the whole reason the switch exists. It is global here
   * rather than per-card so two panels can never sit side by side on different
   * bases.
   */

  const allInvoices = useMemo(() => {
    if (Array.isArray(invoicesProp)) return invoicesProp;
    return (Array.isArray(db?.invoices) ? db.invoices : []).filter((i) => i.companyId === currentCompany?.id);
  }, [invoicesProp, db, currentCompany]);

  /**
   * The same rule the money-out stream already applies: a draft is an
   * intention, not a liability.
   *
   * It was applied on one side only. A draft invoice counted towards Billed,
   * Outstanding, Average invoice, the aging buckets and "where the money is
   * owed" — and, if its due date had passed, was reported as *overdue* and put
   * on the chase list, on a document nobody had ever sent. The worklist card
   * directly above those numbers says "Nothing is owed until they go out",
   * so the dashboard was contradicting itself within one screen.
   *
   * `allInvoices` stays whole: the draft worklist needs the drafts, and the
   * "no invoices yet" empty state should not claim an empty book when a draft
   * is sitting there.
   */
  const postedInvoices = useMemo(
    () => allInvoices.filter((i) => String(i.status || '').toLowerCase() !== 'draft'),
    [allInvoices]
  );


  /**
   * The four figures at the top are two balances and two flows, and they are
   * not the same kind of thing.
   *
   * Cash, receivables, payables and the GST position are true *now*. The
   * period control below governs what happened over a window; applying it to a
   * balance would produce "cash available in the last 30 days", which is not a
   * quantity. So these are computed as of today and labelled that way.
   */
  const cash = useMemo(() => cashPosition(db, currentCompany?.id), [db, currentCompany]);
  const recv = useMemo(() => receivablesAsOf(db, currentCompany?.id), [db, currentCompany]);
  const pay = useMemo(() => payablesAsOf(db, currentCompany?.id), [db, currentCompany]);
  const gst = useMemo(() => gstPosition(db, currentCompany?.id), [db, currentCompany]);

  /**
   * Stock for the warehouse in the header, not for the whole company.
   *
   * The selector sits above this page and governed nothing on it, which is the
   * kind of control that teaches people the filters do not work.
   */
  const stock = useMemo(() => {
    try {
      const summary = computeInventorySummaryByItemId({
        db,
        companyId: currentCompany?.id,
        warehouseId: String(activeWarehouseId || ''),
      });
      const items = (Array.isArray(db?.items) ? db.items : []).filter((i) => i.companyId === currentCompany?.id);
      let value = 0;
      const low = [];
      let out = 0;
      for (const item of items) {
        const row = summary.get(String(item.id));
        const qty = Number(row?.closingQty ?? 0);
        const rate = Number(item.purchasePrice ?? 0);
        if (Number.isFinite(qty) && Number.isFinite(rate)) value += qty * rate;
        const reorder = Number(item.reorderLevel ?? 0);
        if (qty <= 0) out += 1;
        else if (reorder > 0 && qty <= reorder) low.push({ name: item.name, qty, unit: item.unit });
      }
      return { value, low: low.slice(0, 3), lowCount: low.length, out, itemCount: items.length };
    } catch {
      // A stock summary that throws must not take the dashboard with it.
      return null;
    }
  }, [db, currentCompany, activeWarehouseId]);

  // Pinned once per mount rather than read during render: "now" moving between
  // renders makes the bucketing impure, and every memo below depends on it.
  const [now] = useState(() => Date.now());
  const today = new Date(now).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [homePeriod, setHomePeriod] = useState('month');
  const [customFrom, setCustomFrom] = useState(monthStart);
  const [customTo, setCustomTo] = useState(today);
  const [customPeriodOpen, setCustomPeriodOpen] = useState(false);
  const [draftCustomFrom, setDraftCustomFrom] = useState(monthStart);
  const [draftCustomTo, setDraftCustomTo] = useState(today);

  const homeRange = useMemo(() => {
    const end = new Date(`${today}T00:00:00`);
    let start;
    if (homePeriod === 'year') start = new Date(end.getFullYear(), 0, 1);
    else if (homePeriod === '30days') start = new Date(end.getTime() - 29 * DAY);
    else if (homePeriod === 'custom') {
      const from = String(customFrom || today).slice(0, 10);
      const to = String(customTo || today).slice(0, 10);
      return from <= to ? { from, to } : { from: to, to: from };
    } else start = new Date(end.getFullYear(), end.getMonth(), 1);
    return { from: start.toISOString().slice(0, 10), to: today };
  }, [homePeriod, customFrom, customTo, today]);

  /*
   * Home reads the book before it draws. One layout for every state is what
   * produced "every invoice in the book is settled" on a book that had never
   * issued one.
   */
  const state = useMemo(() => bookState(db, currentCompany), [db, currentCompany]);
  /*
   * Home follows ActionGuard's rule: what the person cannot VIEW is left out;
   * anything else they cannot do is shown disabled, naming the permission,
   * so a missing feature and a withheld one look different and the person
   * knows what to ask an administrator for. A setup step they cannot
   * complete stays listed, marked for an administrator.
   */
  const { can, canModule } = usePermissions();
  const steps = useMemo(() => {
    const needs = {
      company: 'SETTINGS::Company Profile::EDIT',
      gstin: 'SETTINGS::Company Profile::EDIT',
      customer: 'MASTERS::Customers::CREATE',
      item: 'MASTERS::Items::CREATE',
      invoice: 'SALES::Invoices::CREATE',
      bank: 'CASHBANK::Cash & Bank::CREATE',
    };
    return setupSteps(db, currentCompany).map((step) => ({
      ...step,
      allowed: !needs[step.key] || can(needs[step.key]),
    }));
  }, [db, currentCompany, can]);
  const goTo = (where) => {
    if (where === 'newInvoice') return onNewInvoice?.();
    if (where === 'customers') return onOpenCustomers?.();
    if (where === 'cashBank') return onOpenCashBank?.();
    return onNavigate?.(where);
  };












  /**
   * Insights: observations computed from the figures already on this page.
   * Every line cites its numbers; nothing is predicted and nothing is
   * invented. An empty list renders nothing rather than filler.
   */


  /**
   * The sentence under the greeting.
   *
   * Every one of these is a fact from the book with something to do about it.
   * Order is by how much it costs to ignore: money already late, then a
   * statutory window, then money going out, then work left unfinished. An
   * empty list renders as "nothing needs you right now", which is a true
   * thing to say and the reason the line stays credible.
   */
  const draftCount = useMemo(
    () => allInvoices.filter((i) => String(i.status || '').toLowerCase() === 'draft').length,
    [allInvoices]
  );

  /**
   * How many invoices the overdue money is spread across — the same test the
   * worklist below uses, so the two cannot disagree. `receivables()` returns
   * the overdue amount but not its count.
   */
  const overdueCount = useMemo(() => {
    const todayStr = new Date(now).toISOString().slice(0, 10);
    return postedInvoices.filter(
      (i) =>
        Math.max(0, num(i?.total) - num(i?.paidAmount)) > 0 &&
        String(i.dueDate || '') &&
        String(i.dueDate) < todayStr
    ).length;
  }, [postedInvoices, now]);

  const heroInsights = useMemo(() => {
    const out = [];

    if (recv.overdue > 0) {
      out.push({
        key: 'overdue',
        label: `${formatMoney(recv.overdue, currentCompany)} overdue across ${overdueCount} invoice${overdueCount === 1 ? '' : 's'}${recv.oldestDays ? `, oldest ${recv.oldestDays} days` : ''}`,
        text: (
          <>
            There&rsquo;s <b className="ui-mono" style={{ color: 'rgb(var(--neg))', fontWeight: 600 }}>{formatMoney(recv.overdue, currentCompany)}</b>{' '}
            overdue across {overdueCount} invoice{overdueCount === 1 ? '' : 's'}
            {recv.oldestDays ? <> — the oldest by <b style={{ color: 'rgb(var(--fg))' }}>{recv.oldestDays} days</b></> : null}.
          </>
        ),
      });
    }

    if (Number.isFinite(gst.daysToGstr1) && gst.daysToGstr1 >= 0 && gst.daysToGstr1 <= 15) {
      out.push({
        key: 'gst',
        label: `GSTR-1 closes in ${gst.daysToGstr1} day${gst.daysToGstr1 === 1 ? '' : 's'}${gst.draftsInMonth > 0 ? `, ${gst.draftsInMonth} draft invoice${gst.draftsInMonth === 1 ? '' : 's'} would be left out` : ''}`,
        text: (
          <>
            <b style={{ color: 'rgb(var(--fg))' }}>GSTR-1</b> closes in{' '}
            <b style={{ color: 'rgb(var(--warn))' }}>
              {gst.daysToGstr1} day{gst.daysToGstr1 === 1 ? '' : 's'}
            </b>
            {gst.draftsInMonth > 0 ? (
              <>
                {' '}
                — {gst.draftsInMonth} draft invoice{gst.draftsInMonth === 1 ? '' : 's'} would be left out.
              </>
            ) : (
              '.'
            )}
          </>
        ),
      });
    }

    if (pay.dueThisWeek > 0) {
      out.push({
        key: 'due',
        label: `${formatMoney(pay.dueThisWeek, currentCompany)} of bills falls due this week`,
        text: (
          <>
            <b className="ui-mono" style={{ color: 'rgb(var(--fg))', fontWeight: 600 }}>{formatMoney(pay.dueThisWeek, currentCompany)}</b>{' '}
            of bills falls due this week.
          </>
        ),
      });
    }

    if (draftCount > 0) {
      out.push({
        key: 'drafts',
        label: `${draftCount} invoice${draftCount === 1 ? '' : 's'} still in draft, not counted in what you are owed`,
        text: (
          <>
            <b style={{ color: 'rgb(var(--fg))' }}>{draftCount} invoice{draftCount === 1 ? '' : 's'}</b>{' '}
            {draftCount === 1 ? 'is' : 'are'} still a draft, so {draftCount === 1 ? 'it is' : 'they are'} not counted in what you are owed.
          </>
        ),
      });
    }

    if (stock?.out > 0) {
      out.push({
        key: 'stock',
        label: `${stock.out} item${stock.out === 1 ? '' : 's'} out of stock`,
        text: (
          <>
            <b style={{ color: 'rgb(var(--fg))' }}>{stock.out} item{stock.out === 1 ? '' : 's'}</b> {stock.out === 1 ? 'is' : 'are'} out of stock.
          </>
        ),
      });
    }

    return out;
  }, [recv, gst, pay, draftCount, overdueCount, stock, currentCompany]);

  /** Five is enough to act on; a ranking longer than that is a report. */
  /**
   * Money in and money out, by month.
   *
   * The one thing on a peer's home screen this page had no answer to, and the
   * thing that fills the room the setup list leaves when it is finished — a
   * dashboard that loses a section on the day setup completes is a dashboard
   * with a hole in it from then on. Cash available is a balance; this is the
   * direction, which is the question an owner actually opens the app with.
   *
   * Built from posted documents only, on the same rule the rest of the page
   * uses: a draft is an intention and does not belong in a trend.
   */
  const flow = useMemo(() => {
    const months = [];
    const base = new Date(now);
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleString(undefined, { month: 'short' }),
        inAmt: 0,
        outAmt: 0,
      });
    }
    const index = new Map(months.map((m) => [m.key, m]));
    const add = (dateIso, field, amount) => {
      const key = String(dateIso || '').slice(0, 7);
      const row = index.get(key);
      if (row) row[field] += Number(amount || 0);
    };
    for (const inv of postedInvoices) add(inv.date, 'inAmt', inv.total);
    for (const b of (Array.isArray(db?.bills) ? db.bills : []).filter((x) => x.companyId === currentCompany?.id)) {
      if (String(b.status || '').toLowerCase() === 'draft') continue;
      add(b.date, 'outAmt', b.total);
    }
    for (const expense of (Array.isArray(db?.expenses) ? db.expenses : []).filter((x) => x.companyId === currentCompany?.id)) {
      if (String(expense.status || '').toLowerCase() === 'draft') continue;
      add(expense.date, 'outAmt', expense.total ?? expense.amount);
    }
    const peak = Math.max(1, ...months.map((m) => Math.max(m.inAmt, m.outAmt)));
    return { months, peak, any: months.some((m) => m.inAmt || m.outAmt) };
  }, [postedInvoices, db, currentCompany, now]);

  const topDebtors = useMemo(
    () => (Array.isArray(recv?.byCustomer) ? recv.byCustomer : []).filter((c) => c.amount > 0).slice(0, 5),
    [recv]
  );

  /**
   * How far through the filing window we are, as a percentage.
   *
   * The window is the eleven days from the start of the month to the 11th,
   * which is when GSTR-1 is due for a monthly filer. The dial fills as the
   * time runs out, so a full dial means "file today", not "all done".
   */
  const gstWindowPct = useMemo(() => {
    const left = Number(gst?.daysToGstr1);
    if (!Number.isFinite(left)) return 0;
    if (left < 0) return 100;
    return Math.max(0, Math.min(100, Math.round(((11 - left) / 11) * 100)));
  }, [gst]);

  const userEmail = (() => {
    try {
      return localStorage.getItem('userEmail') || '';
    } catch {
      return '';
    }
  })();
  /**
   * The shell has already resolved who this is from /auth/me, so prefer that.
   * Parsing the email is the fallback for the first paint, before the profile
   * lands — it is why the greeting said "Test" for an address like
   * test@… even after a real first name had been saved.
   */
  const heroName = String(userName || '').trim().split(/\s+/)[0] || nameFromEmail(userEmail);

  const openBills = useMemo(
    () =>
      (Array.isArray(db?.bills) ? db.bills : [])
        .filter((b) => b.companyId === currentCompany?.id)
        .filter((b) => {
          const st = String(b.status || '').toLowerCase();
          return st !== 'draft' && st !== 'paid' && st !== 'cancelled';
        }),
    [db, currentCompany]
  );

  const homePerformance = useMemo(() => {
    const companyId = currentCompany?.id;
    const live = (doc) => doc?.companyId === companyId && !['draft', 'cancelled'].includes(String(doc?.status || '').toLowerCase());
    const inRange = (row, range) => {
      const date = String(row.date || '').slice(0, 10);
      return date && date >= range.from && date <= range.to;
    };
    const sumRange = (rows, range) => rows.filter(live).filter((row) => inRange(row, range)).reduce((sum, row) => sum + num(row.total ?? row.amount), 0);
    const invoices = Array.isArray(db?.invoices) ? db.invoices : [];
    const bills = Array.isArray(db?.bills) ? db.bills : [];
    const expenses = Array.isArray(db?.expenses) ? db.expenses : [];
    const fromDate = new Date(`${homeRange.from}T00:00:00`);
    const toDate = new Date(`${homeRange.to}T00:00:00`);
    const span = Math.max(1, Math.round((toDate - fromDate) / DAY) + 1);
    const previousTo = new Date(fromDate.getTime() - DAY);
    const previousFrom = new Date(previousTo.getTime() - (span - 1) * DAY);
    const previousRange = { from: previousFrom.toISOString().slice(0, 10), to: previousTo.toISOString().slice(0, 10) };
    const amount = {
      sales: sumRange(invoices, homeRange),
      purchases: sumRange(bills, homeRange),
      expenses: sumRange(expenses, homeRange),
      previousSales: sumRange(invoices, previousRange),
      previousPurchases: sumRange(bills, previousRange),
      previousExpenses: sumRange(expenses, previousRange),
    };
    amount.profit = amount.sales - amount.purchases - amount.expenses;
    amount.previousProfit = amount.previousSales - amount.previousPurchases - amount.previousExpenses;
    const delta = (value, prior) => prior ? Math.round((value - prior) / Math.abs(prior) * 100) : value ? 100 : 0;
    amount.deltas = {
      sales: delta(amount.sales, amount.previousSales),
      purchases: delta(amount.purchases, amount.previousPurchases),
      expenses: delta(amount.expenses, amount.previousExpenses),
      profit: delta(amount.profit, amount.previousProfit),
    };

    const itemById = new Map((Array.isArray(db?.items) ? db.items : []).map((item) => [String(item.id), item]));
    const categories = new Map();
    invoices.filter(live).filter((row) => inRange(row, homeRange)).forEach((invoice) => {
      (Array.isArray(invoice.items) ? invoice.items : []).forEach((line) => {
        const item = itemById.get(String(line.itemId || ''));
        const label = String(item?.category || 'Uncategorised').trim() || 'Uncategorised';
        const value = num(line.taxableAmount ?? line.amount ?? (num(line.quantity) * num(line.rate)));
        categories.set(label, (categories.get(label) || 0) + value);
      });
    });
    amount.categories = [...categories.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 5);

    const bucketCount = span <= 45 ? Math.min(6, span) : Math.min(12, Math.max(1, Math.ceil(span / 30)));
    const bucketDays = Math.max(1, Math.ceil(span / bucketCount));
    amount.chart = Array.from({ length: bucketCount }, (_, index) => {
      const start = new Date(fromDate.getTime() + index * bucketDays * DAY);
      const end = new Date(Math.min(toDate.getTime(), start.getTime() + (bucketDays - 1) * DAY));
      const range = { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
      return {
        key: range.from,
        label: span <= 45 ? start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : start.toLocaleDateString(undefined, { month: 'short' }),
        inAmt: sumRange(invoices, range),
        outAmt: sumRange(bills, range) + sumRange(expenses, range),
      };
    }).filter((row) => row.key <= homeRange.to);
    amount.chartPeak = Math.max(1, ...amount.chart.map((row) => Math.max(row.inAmt, row.outAmt)));
    return amount;
  }, [db, currentCompany, homeRange]);

  /** The last few documents raised, whatever kind they were. */
  const activity = useMemo(() => {
    const rows = [];
    const push = (doc, kind, party, tone, status) =>
      rows.push({
        key: `${kind}-${doc.id}`,
        number: String(doc.number || '').trim() || '—',
        party: String(party || '').trim() || '—',
        kind,
        amount: Number(doc.total ?? doc.amount ?? 0),
        status,
        tone,
        date: String(doc.date || ''),
      });

    for (const i of postedInvoices) {
      const st = String(i.status || '').toLowerCase();
      push(i, 'Invoice', i.customerName, st === 'paid' ? 'green' : st === 'overdue' ? 'red' : 'blue',
        st === 'paid' ? 'Paid' : st === 'overdue' ? 'Overdue' : 'Sent');
    }
    for (const b of openBills) push(b, 'Bill', b.vendorName, 'amber', 'Due');
    for (const r of (Array.isArray(db?.payments) ? db.payments : []).filter((x) => x.companyId === currentCompany?.id)) {
      push(r, 'Receipt', r.customerName, 'green', 'Received');
    }

    return rows.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5);
  }, [postedInvoices, openBills, db, currentCompany]);

  const quickActions = [
    onNewInvoice ? { label: 'New invoice', Icon: FileText, onClick: onNewInvoice, permission: 'SALES::Invoices::CREATE' } : null,
    onRecordReceipt ? { label: 'Record receipt', Icon: Receipt, onClick: onRecordReceipt, permission: 'SALES::Receipts::CREATE' } : null,
    onNewBill ? { label: 'New bill', Icon: Wallet, onClick: onNewBill, permission: 'PURCHASE::Bills::CREATE' } : null,
    onOpenCustomers ? { label: 'Add customer', Icon: Plus, onClick: onOpenCustomers, permission: 'MASTERS::Customers::CREATE' } : null,
    // Reports is somewhere to look, not something to do: without it, it is left out.
    onOpenReports && canModule('REPORTS') ? { label: 'Reports', Icon: TrendingUp, onClick: onOpenReports } : null,
  ].filter(Boolean);

  /*
   * Home, once the books are running.
   *
   * The setup list answers "what do I still have to do" and this answers "what
   * is happening" — a different screen, not a longer version of the same one.
   * The analytical panels below are for the states before this one; a running
   * book gets the four figures, the two panels with dates in them, and the
   * three summaries underneath.
   */
  // Once any bookkeeping activity exists, Home keeps one consistent dashboard.
  // A purchase-only company used to fall back to the setup composition, which
  // made the redesigned dashboard disappear until the first sales invoice.
  if (state !== BOOK_NEW) {
    const nav = (key) => (onNavigate ? () => onNavigate(key) : null);
    const viewAll = (onClick) => onClick ? (
      <button type="button" onClick={onClick} className="ui-link inline-flex items-center gap-1 text-xs">View all <ArrowRight size={12} /></button>
    ) : null;
    const flowIncome = homePerformance.chart.map((row) => row.inAmt);
    const flowOut = homePerformance.chart.map((row) => row.outAmt);
    const profitSeries = homePerformance.chart.map((row) => row.inAmt - row.outAmt);

    return (
      <div className="space-y-3 max-md:px-3">
        <header className="flex flex-wrap items-start justify-between gap-3 px-0.5">
          <div>
            <h1 className="ui-t-page">{greetingFor(new Date(now).getHours())}{heroName ? `, ${heroName}` : ''}</h1>
            <p className="ui-muted mt-0.5 text-sm">Here&apos;s what&apos;s happening with your business today.</p>
          </div>
          <div className="flex items-center gap-2">
            <Clock size={14} className="ui-subtle" aria-hidden="true" />
            <div className="relative">
              <select
                className="ui-select ui-control-sm min-w-[9.5rem]"
                aria-label="Dashboard period"
                value={homePeriod}
                onChange={(event) => {
                  const value = event.target.value;
                  setHomePeriod(value);
                  setCustomPeriodOpen(value === 'custom');
                  if (value === 'custom') {
                    setDraftCustomFrom(customFrom);
                    setDraftCustomTo(customTo);
                  }
                }}
                onClick={() => {
                  if (homePeriod === 'custom') setCustomPeriodOpen(true);
                }}
              >
                <option value="month">This Month</option>
                <option value="year">This Year</option>
                <option value="30days">Last 30 Days</option>
                <option value="custom">Custom Period</option>
              </select>
              {customPeriodOpen ? (
                <div className="absolute right-0 top-[calc(100%+0.4rem)] z-30 w-72 rounded-xl border bg-[rgb(var(--surface))] p-3 shadow-xl" style={{ borderColor: 'rgb(var(--border))' }} role="dialog" aria-label="Select custom period">
                  <h2 className="ui-t-sec">Custom Period</h2>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="ui-label">From<input type="date" className="ui-input mt-1 w-full text-sm" aria-label="Custom period start" value={draftCustomFrom} max={draftCustomTo || today} onChange={(event) => setDraftCustomFrom(event.target.value)} /></label>
                    <label className="ui-label">To<input type="date" className="ui-input mt-1 w-full text-sm" aria-label="Custom period end" value={draftCustomTo} min={draftCustomFrom || ''} max={today} onChange={(event) => setDraftCustomTo(event.target.value)} /></label>
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setCustomPeriodOpen(false)}>Cancel</button>
                    <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={() => { setCustomFrom(draftCustomFrom); setCustomTo(draftCustomTo); setCustomPeriodOpen(false); }}>Apply</button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <HomeMetric label="Total Sales" value={homePerformance.sales} company={currentCompany} Icon={TrendingUp} tone="green" change={homePerformance.deltas.sales} series={flowIncome} />
          <HomeMetric label="Total Purchases" value={homePerformance.purchases} company={currentCompany} Icon={Wallet} tone="blue" change={homePerformance.deltas.purchases} series={flowOut} />
          <HomeMetric label="Total Expenses" value={homePerformance.expenses} company={currentCompany} Icon={Receipt} tone="red" change={homePerformance.deltas.expenses} series={[homePerformance.previousExpenses, homePerformance.expenses]} />
          <HomeMetric label="Net Profit" value={homePerformance.profit} company={currentCompany} Icon={BarChart3} tone="violet" change={homePerformance.deltas.profit} series={profitSeries} />
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(16rem,.8fr)_minmax(17rem,.8fr)]">
          <HomePanel title="Income vs Expense"><HomeBars rows={homePerformance.chart} peak={homePerformance.chartPeak} company={currentCompany} /></HomePanel>
          <HomePanel title="Sales by Category"><HomeDoughnut rows={homePerformance.categories} total={homePerformance.categories.reduce((sum, row) => sum + row.value, 0)} company={currentCompany} /></HomePanel>
          <HomePanel title="Bank & Cash Balance" action={viewAll(onOpenCashBank || nav('cashBank'))}>
            <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
              {cash.accounts.slice(0, 4).map((account) => (
                <li key={account.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{account.bank || account.name}</span>
                  <span className="ui-money shrink-0">{formatMoney(account.opening, currentCompany)}</span>
                </li>
              ))}
              {!cash.accounts.length ? <li className="ui-muted py-5 text-center text-sm">No bank or cash ledger yet.</li> : null}
            </ul>
            <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm font-semibold" style={{ borderColor: 'rgb(var(--border))' }}>
              <span>Total Balance</span><span className="ui-money">{formatMoney(cash.total, currentCompany)}</span>
            </div>
          </HomePanel>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(19rem,1.08fr)]">
          <HomePanel title="Receivables (Customers)" action={viewAll(can('SALES::Invoices::VIEW') ? onOpenInvoices || nav('invoices') : null)}>
            <HomeDueList rows={recv.byCustomer || []} company={currentCompany} empty="No customer balance is outstanding." />
          </HomePanel>
          <HomePanel title="Payables (Vendors)" action={viewAll(can('PURCHASE::Bills::VIEW') ? nav('bills') : null)}>
            <HomeDueList rows={pay.rows || []} company={currentCompany} empty="No vendor balance is outstanding." />
          </HomePanel>
          <HomePanel title="Recent Transactions" action={viewAll(can('REPORTS::Trial Balance::VIEW') ? onOpenReports || nav('reports') : null)}>
            {activity.length ? (
              <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
                {activity.slice(0, 5).map((row) => (
                  <li key={row.key} className="flex items-center gap-2 py-2">
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[rgb(var(--surface-sunken))]"><FileText size={13} /></span>
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{row.kind}</div><div className="ui-caption truncate">{row.number} · {row.party}</div></div>
                    <span className="ui-money text-sm">{formatMoney(row.amount, currentCompany)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="ui-muted py-6 text-center text-sm">No transactions recorded yet.</p>}
          </HomePanel>
        </div>
      </div>
    );
  }

  return (
    /* The shell gives Home no side padding; on a phone the greeting would touch the glass. */
    <div className="ui-hero-ground space-y-6 max-md:px-3">
      {/*
        The opening composition, in place of a page header and four cards.

        A dashboard is the one screen with no task on it, so it does not need a
        title telling you where you are — you can see that in the rail. What it
        needs is to say the one thing worth knowing before you decide what to
        do, which is what the line under the greeting is for.
      */}
      <DashboardHero
        name={heroName}
        insights={heroInsights}
        actions={quickActions}
      />

      {/* Nothing to summarise: Home is the setup list, and only that. */}
      {state === BOOK_NEW ? <SetupChecklist steps={steps} onGo={goTo} /> : null}

      {/* Figures are real but nothing has been billed — say so above them. */}
      {state === BOOK_SETUP ? (
        <NothingBilledYet
          payable={pay.total}
          stockValue={stock.value}
          company={currentCompany}
          onNewInvoice={onNewInvoice}
        />
      ) : null}

      {state === BOOK_NEW ? null : (
      <QuietTiles
        company={currentCompany}
        tiles={[
          {
            label: 'Cash available',
            value: cash.total,
            note: cash.accountCount
              ? `${cash.accountCount} ledger${cash.accountCount === 1 ? '' : 's'}`
              : 'no ledger yet',
          },
          {
            label: 'Owed to you',
            value: recv.count ? recv.total : null,
            tone: recv.overdue > 0 ? 'warn' : '',
            note: recv.count ? `${recv.count} invoice${recv.count === 1 ? '' : 's'}` : 'nothing billed',
          },
          {
            label: 'You owe',
            value: pay.count ? pay.total : null,
            tone: pay.total > 0 ? 'neg' : '',
            note: pay.count ? `${pay.count} bill${pay.count === 1 ? '' : 's'}` : 'nothing owed',
          },
          {
            label: gst.creditCarried > 0 ? 'GST credit' : 'GST payable',
            value: gst.output || gst.input ? (gst.creditCarried > 0 ? gst.creditCarried : gst.payable) : null,
            tone: gst.creditCarried > 0 ? 'pos' : '',
            note:
              Number.isFinite(gst.daysToGstr1) && gst.daysToGstr1 >= 0
                ? `GSTR-1 in ${gst.daysToGstr1}d`
                : gst.monthLabel,
          },
          stock
            ? {
                label: 'Stock on hand',
                value: stock.value,
                note: `${stock.itemCount} item${stock.itemCount === 1 ? '' : 's'}${stock.out ? ` · ${stock.out} out` : ''}`,
              }
            : null,
          {
            label: 'Drafts',
            value: draftCount,
            count: true,
            note: draftCount ? 'not in what you are owed' : 'none open',
          },
        ]}
      />
      )}

      {/* Setup is not finished, so the remaining steps stay in view beside the
          figures rather than vanishing the moment a first bill is entered. */}
      {state === BOOK_SETUP ? <SetupChecklist steps={steps} onGo={goTo} /> : null}

      {/*
        The three things worth a look every morning, and the reason each one is
        a different shape.

        Ageing is a proportion, so it is a bar you read left to right. Debtors
        are a ranking, so they are bars you read top to bottom. The filing
        window is a countdown against a fixed date, so it is a dial. Giving all
        three the same card would have made them look like the same kind of
        fact, and they are not.

        All three are "as of today" and none of them moves with the period
        control below — which is exactly why they sit above it.
      */}
      {/*
        Money in against money out, in the room the setup list vacates.

        A page that loses a section the day setup finishes has a hole in it
        from then on, and this is the panel the category expects and this one
        did not have. Full width above the three, because a trend is read
        across and the other three are read down.
      */}
      {state === BOOK_NEW || state === BOOK_SETUP ? null : (
      <section className="ui-card p-4" aria-label="Money in and out">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="ui-t-sec">Money in and out</h2>
          <p className="ui-subtle ui-t-body">Last six months · posted documents only</p>
        </div>

        {flow.any ? (
          <>
            <div className="mt-3 flex items-end gap-3" style={{ height: 92 }}>
              {flow.months.map((m) => (
                <div key={m.key} className="flex-1 min-w-0 flex flex-col justify-end" style={{ height: '100%' }}>
                  <div className="flex items-end justify-center gap-1" style={{ height: '100%' }}>
                    <span
                      className="w-1/3 rounded-t"
                      style={{
                        height: `${Math.max(m.inAmt ? 3 : 0, (m.inAmt / flow.peak) * 100)}%`,
                        backgroundColor: 'rgb(var(--st-paid-key))',
                      }}
      title={`In ${formatMoney(m.inAmt, currentCompany)}`}
                    />
                    <span
                      className="w-1/3 rounded-t"
                      style={{
                        height: `${Math.max(m.outAmt ? 3 : 0, (m.outAmt / flow.peak) * 100)}%`,
                        backgroundColor: 'rgb(var(--st-overdue-key))',
                      }}
      title={`Out ${formatMoney(m.outAmt, currentCompany)}`}
                    />
                  </div>
                  <span className="ui-caption block text-center mt-1.5 truncate">{m.label}</span>
                </div>
              ))}
            </div>
            {/* The hues carry the reading, so the words carry it too. */}
            <div className="mt-2 flex items-center gap-4 flex-wrap">
              <span className="ui-t-body inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: 'rgb(var(--st-paid-key))' }} aria-hidden="true" />
                In
                <b className="ui-mono">{formatMoney(flow.months.reduce((a, m) => a + m.inAmt, 0), currentCompany)}</b>
              </span>
              <span className="ui-t-body inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: 'rgb(var(--st-overdue-key))' }} aria-hidden="true" />
                Out
                <b className="ui-mono">{formatMoney(flow.months.reduce((a, m) => a + m.outAmt, 0), currentCompany)}</b>
              </span>
            </div>
          </>
        ) : (
          <p className="ui-subtle ui-t-body mt-3">Nothing posted in the last six months.</p>
        )}
      </section>
      )}

      {/* A panel with nothing to report is a hole with a caption. The three
          below all answer questions about receivables, so they wait until
          there are some. */}
      {state === BOOK_NEW || state === BOOK_SETUP ? null : (
      <section className="grid gap-3 lg:grid-cols-3 pt-2" aria-label="Today">
        {/* Proportion — where the receivable book is sitting. */}
        <div className="ui-card p-4 flex flex-col">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="ui-t-sec">Outstanding by age</h2>
            {recv.count ? (
              <button type="button" onClick={onOpenInvoices} className="ui-t-body" style={{ color: 'rgb(var(--brand-ink))', fontWeight: 600 }}>
                All invoices
              </button>
            ) : null}
          </div>
          <p className="ui-subtle ui-t-body mt-0.5">
            {recv.count ? (
              <>
                <span className="ui-money">{formatMoney(recv.total, currentCompany)}</span> across {recv.count} invoice
                {recv.count === 1 ? '' : 's'}
              </>
            ) : (
              'Nothing outstanding'
            )}
          </p>

          {recv.total > 0 ? (
            <>
              <AgeingBar buckets={recv.buckets} total={recv.total} company={currentCompany} onPick={onOpenInvoices ? () => onOpenInvoices() : undefined} />
              {recv.oldestDays > 0 ? (
                <p className="ui-subtle ui-t-body mt-auto pt-3">
                  Oldest is <b style={{ color: 'rgb(var(--neg))' }}>{recv.oldestDays} days</b> past due.
                </p>
              ) : null}
            </>
          ) : (
            /*
              These three panels sit side by side, so one of them going empty
              cannot just print a sentence and leave two hundred pixels of
              nothing under it — which is exactly what it did, next to two
              siblings full of bars and a dial. The art fills the space the
              grid is holding open anyway, and says the same thing the sentence
              does.
            */
            <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
              <Illustration kind="done" size={78} className="mb-3 opacity-90" />
              <p className="ui-subtle ui-t-body">Every invoice in the book is settled.</p>
            </div>
          )}
        </div>

        {/* Ranking — who to call first. */}
        <div className="ui-card p-4 flex flex-col">
          <h2 className="ui-t-sec">Who owes you most</h2>
          <p className="ui-subtle ui-t-body mt-0.5">
            {topDebtors.length ? 'By balance, with how late the oldest is' : 'Nobody owes you anything'}
          </p>
          {!topDebtors.length ? (
            <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
              <Illustration kind="done" size={78} className="mb-3 opacity-90" />
              <p className="ui-subtle ui-t-body">Nothing to chase today.</p>
            </div>
          ) : null}

          {topDebtors.length ? (
            <div className="mt-3 space-y-2.5 flex-1 flex flex-col">
              {topDebtors.map((c) => {
                const share = recv.total > 0 ? Math.max(4, Math.round((c.amount / recv.total) * 100)) : 0;
                return (
                  <div key={c.name}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="ui-t-body truncate" style={{ color: 'rgb(var(--col-party))', fontWeight: 600 }}>{c.name}</span>
                      <span className="ui-money ui-t-body" style={{ fontWeight: 600 }}>{formatMoney(c.amount, currentCompany)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="h-1.5 flex-1 rounded-full overflow-hidden" style={{ backgroundColor: 'rgb(var(--surface-sunken))' }}>
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${share}%`, backgroundColor: c.oldest > 0 ? 'rgb(var(--neg))' : 'rgb(var(--brand))' }}
                        />
                      </span>
                      <span className="ui-subtle" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                        {c.oldest > 0 ? `${c.oldest}d late` : 'not due'}
                      </span>
                    </div>
                  </div>
                );
              })}

              {/*
                What the list above adds up to, pinned to the foot of the card.
                A book with one customer has one row and two hundred pixels of
                nothing under it; this is not filler, it is the two facts a
                collections conversation opens with — how much is out, and
                whether any of it is late — and it anchors the card instead of
                leaving it to float.
              */}
              <div
                className="mt-auto pt-3 flex items-baseline justify-between gap-3"
                style={{ borderTop: '1px solid rgb(var(--border))' }}
              >
                <span className="ui-subtle ui-t-body">
                  {topDebtors.length} customer{topDebtors.length === 1 ? '' : 's'}
                  {recv.count ? ` · ${recv.count} invoice${recv.count === 1 ? '' : 's'}` : ''}
                </span>
                <span className="ui-t-body" style={{ color: recv.oldestDays > 0 ? 'rgb(var(--neg))' : 'rgb(var(--pos))', fontWeight: 500 }}>
                  {recv.oldestDays > 0 ? `oldest ${recv.oldestDays}d late` : 'none overdue'}
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Countdown — a fixed date the tax office set, not one you chose. */}
        <div className="ui-card p-4 flex flex-col">
          <h2 className="ui-t-sec">GSTR-1 filing</h2>
          <p className="ui-subtle ui-t-body mt-0.5">{gst.monthLabel}</p>

          {Number.isFinite(gst.daysToGstr1) ? (
            <div className="mt-2 flex-1">
              <Suspense fallback={<ChartFallback height={150} />}>
                <RadialGauge
                  value={gstWindowPct}
                  label="Filing window"
                  centerText={
                    gst.daysToGstr1 < 0
                      ? 'Overdue'
                      : `${gst.daysToGstr1}d left`
                  }
                  height={150}
                  tone={gst.daysToGstr1 < 0 ? 'neg' : gst.daysToGstr1 <= 5 ? 'neg' : gst.daysToGstr1 <= 10 ? '' : 'pos'}
                />
              </Suspense>
              <div className="flex items-baseline justify-between gap-3 mt-1">
                <span className="ui-subtle ui-t-body">
                  {gst.creditCarried > 0 ? 'Credit carried' : 'Payable'}
                </span>
                <span className="ui-money ui-t-body" style={{ fontWeight: 600 }}>
                  {formatMoney(gst.creditCarried > 0 ? gst.creditCarried : gst.payable, currentCompany)}
                </span>
              </div>
              {gst.draftsInMonth > 0 ? (
                <p className="ui-t-body mt-2" style={{ color: 'rgb(var(--warn))' }}>
                  {gst.draftsInMonth} draft invoice{gst.draftsInMonth === 1 ? '' : 's'} would be left out of this return.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="ui-subtle ui-t-body mt-3">Nothing to file for this period yet.</p>
          )}
        </div>
      </section>
      )}

      {/*
        The period-governed detail used to live here: the thirty-day cash
        projection, stock on hand, the setup checklist, income against
        expenses, recent activity, the worklist and two ranked charts.

        Removed on request. The dashboard is now the greeting, the six figures
        and the three things worth a look every morning — everything on it is
        as-of-today, which is why the period control went with them.

        Where each one went, so nothing is quietly lost:
          · Cash projection and income vs expenses — Reports › Cash Flow and P&L
          · Recent activity — the module lists, each with its own dates
          · Setup checklist and worklist — no other home. If a new company
            needs the nudge back, this is the block to restore; the components
            are still in this file and cost nothing while unused.
      */}
    </div>
  );
}
