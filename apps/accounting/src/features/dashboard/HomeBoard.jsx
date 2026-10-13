import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  BarChart3,
  ChevronRight,
  Clock,
  FileText,
  Landmark,
  LayoutGrid,
  Package,
  Receipt,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react';

import { formatMoney, formatMoneyCompact } from '@ui/utils/money';

/**
 * Home, once the books are running.
 *
 * The setup list answers "what do I still have to do"; this answers "what is
 * happening", which is a different screen and not a longer version of the same
 * one. Four figures across the top — what is owed to you, what you owe, what is
 * in the bank, what you sold — then the two panels a morning actually starts
 * from: the things with a date on them, and the way back to the jobs.
 *
 * Everything here is rendered from figures the dashboard already computes. No
 * panel invents a number, and a panel with nothing in it says so rather than
 * showing a zero that looks like an answer.
 */

const TONES = {
  blue: { solid: 'rgb(var(--ov-blue))', wash: 'rgb(var(--ov-blue-wash))', soft: 'rgb(var(--ov-blue-soft))' },
  green: { solid: 'rgb(var(--ov-green))', wash: 'rgb(var(--ov-green-wash))', soft: 'rgb(var(--ov-green-soft))' },
  amber: { solid: 'rgb(var(--ov-amber))', wash: 'rgb(var(--ov-amber-wash))', soft: 'rgb(var(--ov-amber-soft))' },
  violet: { solid: 'rgb(var(--ov-violet))', wash: 'rgb(var(--ov-violet-wash))', soft: 'rgb(var(--ov-violet-soft))' },
  red: { solid: 'rgb(var(--ov-red))', wash: 'rgb(var(--ov-red-wash))', soft: 'rgb(var(--ov-red-soft))' },
};

/** One headline figure, with the one line about it worth reading. */
function StatCard({ tone = 'blue', Icon, label, value, company, count = false, foot, onFoot }) {
  const t = TONES[tone] || TONES.blue;
  return (
    <div className="ui-card p-4" style={{ backgroundColor: t.wash, borderColor: t.soft }}>
      <div className="flex items-center gap-2.5">
        <span
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: t.soft, color: t.solid }}
          aria-hidden="true"
        >
          <Icon size={16} />
        </span>
        <div className="ui-caption min-w-0 truncate">{label}</div>
      </div>
      <div
        className="mt-1.5 whitespace-nowrap tabular-nums"
        style={{ fontSize: 'clamp(0.875rem, 1.35vw, 1rem)', lineHeight: '1.5rem', letterSpacing: '-0.025em' }}
        title={String(count ? value : formatMoney(value, company))}
      >
        {count ? value : formatMoney(value, company)}
      </div>

      {foot ? (
        <button
          type="button"
          onClick={onFoot}
          disabled={!onFoot}
          className="mt-3 flex w-full items-center justify-between gap-2 text-sm disabled:cursor-default"
        >
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            {foot.Icon ? <foot.Icon size={14} aria-hidden="true" style={{ color: foot.tone || t.solid }} /> : null}
            <span className="truncate" style={{ color: foot.tone || 'rgb(var(--fg-muted))' }}>{foot.text}</span>
          </span>
          {onFoot ? <ChevronRight size={14} aria-hidden="true" className="ui-subtle shrink-0" /> : null}
        </button>
      ) : null}
    </div>
  );
}

/** The things with a date on them. */
export function ThingsToDo({ items, onOpenAll }) {
  return (
    <section className="ui-card p-4" aria-label="Things to do">
      <div className="flex items-center justify-between gap-2">
        <h2 className="ui-t-sec">Things to do</h2>
        {onOpenAll ? (
          <button type="button" onClick={onOpenAll} className="ui-icon-btn ui-btn-sm" aria-label="Open the work list">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="ui-muted mt-3 text-sm">Nothing is waiting on you today.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {items.map((it) => (
            <li key={it.key}>
              <button
                type="button"
                onClick={it.onSelect}
                disabled={!it.onSelect}
                className="flex w-full items-center gap-2.5 text-left text-sm disabled:cursor-default"
              >
                <span
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: TONES[it.tone]?.soft, color: TONES[it.tone]?.solid }}
                  aria-hidden="true"
                >
                  <it.Icon size={14} />
                </span>
                <span className="min-w-0 truncate">{it.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The way back to the jobs somebody came here to start. */
export function QuickLinks({ links }) {
  return (
    <section className="ui-card p-4" aria-label="Quick links">
      <div className="flex items-center gap-2">
        <LayoutGrid size={16} aria-hidden="true" style={{ color: 'rgb(var(--brand))' }} />
        <h2 className="ui-t-sec">Quick Links</h2>
      </div>

      <ul className="mt-3 space-y-1">
        {links.map((l) => (
          <li key={l.key}>
            <button
              type="button"
              onClick={l.onSelect}
              disabled={!l.onSelect}
              className="ui-hover-sunken flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm disabled:cursor-default"
            >
              <l.Icon size={16} aria-hidden="true" style={{ color: TONES[l.tone]?.solid }} />
              <span className="min-w-0 flex-1 truncate">{l.label}</span>
              <ChevronRight size={14} aria-hidden="true" className="ui-subtle" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Six months of what came in against what went out.
 *
 * Grouped bars, not stacked: the question is which is bigger, and a stack
 * answers a different one.
 */
export function RevenueExpenses({ months, peak, company, any }) {
  return (
    <section className="ui-card p-4" aria-label="Revenue and expenses">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} aria-hidden="true" style={{ color: TONES.green.solid }} />
          <h2 className="ui-t-sec">Revenue &amp; Expenses</h2>
        </div>
        <span className="ui-caption">Last 6 months</span>
      </div>

      <div className="mt-2 flex items-center gap-4 text-sm">
        {[
          { label: 'Revenue', color: TONES.green.solid },
          { label: 'Expenses', color: 'rgb(var(--brand))' },
        ].map((l) => (
          <span key={l.label} className="ui-muted inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: l.color }} aria-hidden="true" />
            {l.label}
          </span>
        ))}
      </div>

      {any ? (
        <>
          <div className="mt-4 flex items-end gap-3" style={{ height: 180 }}>
            {months.map((m) => (
              <div key={m.key} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                <div className="flex h-full items-end justify-center gap-1.5">
                  <span
      title={`Revenue ${formatMoney(m.inAmt, company)}`}
                    style={{
                      height: `${Math.max(m.inAmt ? 2 : 0, (m.inAmt / peak) * 100)}%`,
                      backgroundColor: TONES.green.solid,
                      width: 14,
                      borderRadius: '4px 4px 0 0',
                    }}
                  />
                  <span
      title={`Expenses ${formatMoney(m.outAmt, company)}`}
                    style={{
                      height: `${Math.max(m.outAmt ? 2 : 0, (m.outAmt / peak) * 100)}%`,
                      backgroundColor: 'rgb(var(--brand))',
                      width: 14,
                      borderRadius: '4px 4px 0 0',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-3">
            {months.map((m) => (
              <div key={m.key} className="ui-caption min-w-0 flex-1 text-center">{m.label}</div>
            ))}
          </div>
        </>
      ) : (
        <p className="ui-muted mt-4 text-sm">Nothing posted in the last six months.</p>
      )}
    </section>
  );
}

/** What came in, what went out, and the difference. */
export function CashFlowPanel({ moneyIn, moneyOut, company, label }) {
  const net = moneyIn - moneyOut;
  return (
    <section className="ui-card p-4" aria-label="Cash flow">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} aria-hidden="true" style={{ color: TONES.green.solid }} />
          <h2 className="ui-t-sec">Cash Flow</h2>
        </div>
        <span className="ui-caption">{label}</span>
      </div>

      <dl className="mt-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <dt className="ui-muted text-sm">Money in</dt>
          <dd className="ui-money" style={{ color: TONES.green.solid }}>{formatMoney(moneyIn, company)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="ui-muted text-sm">Money out</dt>
          <dd className="ui-money" style={{ color: 'rgb(var(--brand))' }}>{formatMoney(moneyOut, company)}</dd>
        </div>
      </dl>

      <div
        className="mt-4 flex items-center justify-between gap-3 rounded-xl px-3 py-3"
        style={{ backgroundColor: net >= 0 ? TONES.green.wash : TONES.red.wash }}
      >
        <span className="text-sm font-medium">Net cash flow</span>
        <span className="ui-money" style={{ color: net >= 0 ? TONES.green.solid : TONES.red.solid }}>
          {net >= 0 ? '+ ' : '− '}
          {formatMoney(Math.abs(net), company)}
        </span>
      </div>
    </section>
  );
}

/** Owed to you, or owed by you, split by when it falls due. */
export function DueSplitPanel({ title, Icon, tone, rows, company, onViewAll }) {
  return (
    <section className="ui-card p-4" aria-label={title}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon size={16} aria-hidden="true" style={{ color: TONES[tone]?.solid }} />
          <h2 className="ui-t-sec">{title}</h2>
        </div>
        {onViewAll ? (
          <button type="button" onClick={onViewAll} className="ui-link inline-flex items-center gap-1 text-sm">
            View all <ArrowRight size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <dl className="mt-3 divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 py-2.5">
            <dt className="ui-muted text-sm">{r.label}</dt>
            <dd className="ui-money" style={{ color: r.tone ? TONES[r.tone]?.solid : undefined }}>
              {formatMoney(r.value, company)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The last few documents, whatever kind they were. */
export function RecentActivity({ rows, company, onViewAll, onOpen }) {
  return (
    <section className="ui-card p-4" aria-label="Recent activity">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText size={16} aria-hidden="true" style={{ color: TONES.blue.solid }} />
          <h2 className="ui-t-sec">Recent Activity</h2>
        </div>
        {onViewAll ? (
          <button type="button" onClick={onViewAll} className="ui-link inline-flex items-center gap-1 text-sm">
            View all <ArrowRight size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="ui-muted mt-3 text-sm">Nothing has been raised yet.</p>
      ) : (
        <ul className="mt-2 divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
          {rows.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => onOpen?.(r)}
                disabled={!onOpen}
                className="flex w-full items-center gap-3 py-2.5 text-left text-sm disabled:cursor-default"
              >
                <span className="ui-mono w-24 shrink-0 truncate">{r.number}</span>
                <span className="min-w-0 flex-1 truncate">{r.party}</span>
                <span className="ui-muted hidden w-20 shrink-0 truncate sm:block">{r.kind}</span>
                <span className="ui-money w-24 shrink-0 text-right">{formatMoneyCompact(r.amount, company)}</span>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-xs"
                  style={{ backgroundColor: TONES[r.tone]?.soft, color: TONES[r.tone]?.solid }}
                >
                  {r.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export { StatCard, TONES, AlertCircle, ArrowUpRight, Banknote, Clock, Landmark, Package, Receipt, UserPlus, Users };
