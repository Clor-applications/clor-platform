import React from 'react';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';

import Illustration from '@ui/components/ui/Illustration';

/**
 * The parts a module overview page is built from.
 *
 * Sales had a real one — a period picker with a comparison, six tinted figures,
 * panels holding charts and recent documents — while Purchases had a
 * placeholder saying statistics would appear here. Rather than write the page
 * twice and let the two drift, the furniture lives here and each module
 * supplies its own figures: what a purchase costs and what a sale earns are
 * not the same question asked twice.
 */

/*
 * Local calendar date, not UTC.
 *
 * `toISOString()` converts to UTC first, so in IST midnight on the 1st is
 * 18:30 on the 31st and every period on this page came out shifted a day —
 * "This Month" read 31 Aug to 29 Sep, and an invoice dated the 1st could fall
 * outside the month it was raised in.
 */
export const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseIso = (v) => {
  const d = new Date(`${String(v || '').slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The periods this page can be read over.
 *
 * Anchored on a timestamp the caller pins once, so "this month" cannot change
 * under a render. Each returns the range and the range immediately before it,
 * because every figure on this page is stated against what it was last time.
 */
export const buildPeriods = (nowTs) => {
  const now = new Date(nowTs);
  const y = now.getFullYear();
  const m = now.getMonth();
  const startOfMonth = (yy, mm) => new Date(yy, mm, 1);
  const endOfMonth = (yy, mm) => new Date(yy, mm + 1, 0);

  const span = (from, to) => ({ from: iso(from), to: iso(to) });
  const daysBack = (n) => {
    const to = new Date(y, m, now.getDate());
    const from = new Date(to);
    from.setDate(from.getDate() - (n - 1));
    const prevTo = new Date(from);
    prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setDate(prevFrom.getDate() - (n - 1));
    return { ...span(from, to), prev: span(prevFrom, prevTo) };
  };

  return [
    {
      key: 'thisMonth',
      label: 'This Month',
      ...span(startOfMonth(y, m), endOfMonth(y, m)),
      prev: span(startOfMonth(y, m - 1), endOfMonth(y, m - 1)),
    },
    {
      key: 'lastMonth',
      label: 'Last Month',
      ...span(startOfMonth(y, m - 1), endOfMonth(y, m - 1)),
      prev: span(startOfMonth(y, m - 2), endOfMonth(y, m - 2)),
    },
    { key: 'last30', label: 'Last 30 Days', ...daysBack(30) },
    { key: 'last90', label: 'Last 90 Days', ...daysBack(90) },
    {
      key: 'thisYear',
      label: 'This Year',
      ...span(new Date(y, 0, 1), new Date(y, 11, 31)),
      prev: span(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31)),
    },
  ];
};

export const prettyDate = (v) => {
  const d = parseIso(v);
  if (!d) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

/*
 * The same date without the year, for the two narrow panels at the foot.
 *
 * Five columns in a third of the page do not fit a four-part date, and the
 * table was squeezing the status column off its own right edge. The year is
 * the least useful part of a date on a list called "recent" — every row is
 * within weeks — so it is the part that goes. The full date stays in the
 * title, and on the invoice itself.
 */
export const shortDate = (v) => {
  const d = parseIso(v);
  if (!d) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

/**
 * One of the figures across the top.
 *
 * The card is white and the colour is in the icon square beside the label —
 * enough that the eye can go back to the same card twice, and nowhere near the
 * figure it would otherwise compete with. Six saturated tiles did the first job
 * and lost the second.
 *
 * `tone` names the metric, not a colour, so the card cannot be tinted by
 * whoever places it — overdue is the red one wherever it appears.
 *
 * The delta is the point of the card as much as the figure: a receivables
 * number means nothing until you know which way it is going.
 */
export const OverviewBand = ({ cols = 5, children }) => (
  /*
   * The row the figures sit in.
   *
   * `cols` is the count at the widest breakpoint only — two on a phone and
   * three on a tablet, because five 19px figures in a 390px viewport is not a
   * row of figures, it is a column of clipped ones.
   */
  <div className="ui-kpi-band" style={{ '--kpi-cols': cols }}>
    {children}
  </div>
);

/**
 * One of the figures across the top.
 *
 * Its own square card, carrying its own tint: a subtle wash of the metric's
 * hue with a slightly stronger edge of the same, which is enough to tell five
 * cards apart at a glance and nowhere near enough to argue with the figure
 * each one holds. `tone` names the metric rather than a colour, so the caller
 * cannot tint it — overdue is the red one wherever it appears.
 *
 * The delta is the point of the cell as much as the figure: a receivables
 * number means nothing until you know which way it is going, and which way is
 * the good way. Rising overdue is bad news wearing the same arrow as rising
 * sales, so the colour follows what the movement means, not where it points.
 */
export const OverviewCard = ({ tone, icon: Icon, label, value, delta = null, deltaGoodWhenUp = true, note = '' }) => {
  const up = Number(delta) > 0;
  const flat = delta === null || delta === undefined || Number(delta) === 0;
  const good = deltaGoodWhenUp ? up : !up;

  return (
    <div
      className="ui-kpi-cell"
      style={{ '--kpi-tone': `var(--kpi-${tone}-ink)` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="ui-kpi-label truncate">{label}</span>
        {/* The icon went with the tinted square it used to sit in. The dot is
            what is left of it: enough to tell two cells apart at a glance,
            not enough to argue with the figure. `Icon` is still accepted so
            neither overview page has to change its call sites. */}
        <span className="ui-kpi-dot" aria-hidden="true" />
      </div>

      <div
        className="ui-kpi-figure truncate"
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </div>

      <div className="ui-kpi-delta flex items-center gap-1 min-w-0">
        {flat ? (
          <span className="ui-muted truncate" title={note || undefined}>{note || '—'}</span>
        ) : (
          <>
            <span
              className="inline-flex items-center gap-0.5 shrink-0"
              style={{ color: good ? 'rgb(var(--pos))' : 'rgb(var(--neg))' }}
            >
              {up ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
              {Math.abs(Number(delta)).toFixed(1)}%
            </span>
            {/* The comparison was only in a tooltip, which is to say it was
                only available to a mouse. */}
            <span
              className="truncate"
              style={{ color: 'rgb(var(--fg-subtle))', fontWeight: 400 }}
            >
              vs last period
            </span>
          </>
        )}
      </div>
    </div>
  );
};

/** Two or three choices, one of them on. */
export const Segmented = ({ options, value, onChange, ariaLabel }) => (
  /* The filled active segment is a selection, and selection is what the brand
     means. The container stays neutral so only the chosen one carries it. */
  <div
    className="inline-flex items-center"
    role="tablist"
    aria-label={ariaLabel}
    style={{
      backgroundColor: 'rgb(var(--seg-bg))',
      border: '1px solid rgb(var(--seg-line))',
      borderRadius: 8,
      padding: 2,
      height: 32,
    }}
  >
    {options.map((o) => {
      const on = o.value === value;
      return (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={on}
          onClick={() => onChange(o.value)}
          className="transition-colors"
          style={{
            height: 26,
            padding: '0 12px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 550,
            ...(on
              ? { backgroundColor: 'rgb(var(--brand))', color: 'rgb(var(--on-brand))' }
              : { backgroundColor: 'transparent', color: 'rgb(var(--fg-muted))' }),
          }}
        >
          {o.label}
        </button>
      );
    })}
  </div>
);

/**
 * A panel with a heading and a control on the same row.
 *
 * `subtitle` is accepted and ignored. A sentence under "Recent Invoices"
 * saying it is your latest sales invoices tells a reader what the heading
 * already told them, and it cost a line of vertical space on every panel of
 * every screen. The prop stays so no caller breaks; the sentence does not
 * render. Where a panel genuinely needs to explain something — an empty state,
 * a warning, a rule about how a figure is worked out — that copy belongs with
 * the thing it explains, not under the title.
 */
// eslint-disable-next-line no-unused-vars -- accepted and deliberately not rendered; see above.
export const Panel = ({ title, subtitle, control, children, className = '', bodyClass = 'justify-center' }) => (
  <section className={`ui-card min-w-0 flex flex-col ${className}`} style={{ padding: 16 }}>
    <div className="flex items-center justify-between gap-3 flex-wrap" style={{ minHeight: 32, marginBottom: 12 }}>
      <h3 className="min-w-0 truncate" style={{ fontSize: 15, fontWeight: 600, lineHeight: '20px' }}>
        {title}
      </h3>
      {control}
    </div>
    {/* Fills the card, so two panels sharing a row end the same height. A
        chart or an empty state centres in whatever space that leaves; a table
        or a stack of buttons stays at the top, which is why the caller says
        which it is. */}
    <div className={`flex-1 min-h-0 flex flex-col ${bodyClass}`}>{children}</div>
  </section>
);

/**
 * What a panel says when the period is empty.
 *
 * "Nothing billed in this period" is true and useless: the book usually has
 * data, just not here, and a flat line at zero with a hover tooltip reads as a
 * chart that failed rather than a window with nothing in it. So the reason is
 * stated, and where the data actually is, the way to it is one button.
 */
export const EmptyPanel = ({ height = 180, title, detail = '', action = null }) => (
  /* Small enough that an empty period does not cost more of the page than a
     full one. The illustration was 72px inside a 240px well; both come down. */
  <div className="flex flex-col items-center justify-center text-center gap-1.5 px-4" style={{ minHeight: height }}>
    <Illustration kind="filtered" size={48} />
    <p style={{ fontSize: 14, fontWeight: 600 }}>{title}</p>
    {detail ? <p className="ui-muted text-xs max-w-sm">{detail}</p> : null}
    {action ? (
      <button type="button" onClick={action.onClick} className="ui-btn ui-btn-secondary mt-1">
        {action.label}
      </button>
    ) : null}
  </div>
);

export const OverviewStatusPill = ({ status }) => {
  const key = String(status || '').toLowerCase();
  const map = {
    paid: { bg: 'var(--ov-green-soft)', fg: 'var(--ov-green)', label: 'Paid' },
    'over due': { bg: 'var(--ov-red-soft)', fg: 'var(--ov-red)', label: 'Overdue' },
    overdue: { bg: 'var(--ov-red-soft)', fg: 'var(--ov-red)', label: 'Overdue' },
    partial: { bg: 'var(--ov-amber-soft)', fg: 'var(--ov-amber)', label: 'Partial' },
    draft: { bg: 'var(--info-soft)', fg: 'var(--fg-muted)', label: 'Draft' },
    cancelled: { bg: 'var(--info-soft)', fg: 'var(--fg-muted)', label: 'Cancelled' },
  };
  const it = map[key] || { bg: 'var(--ov-amber-soft)', fg: 'var(--ov-amber)', label: 'Pending' };
  return (
    <span
      /* A status word on a soft ground is a pill, like every other one in the
         product — it was the only status label drawn as a rounded box. */
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `rgb(${it.bg})`, color: `rgb(${it.fg})` }}
    >
      {it.label}
    </span>
  );
};

export const PanelLink = ({ children, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-1 text-sm"
    style={{ color: 'rgb(var(--link))' }}
  >
    {children} <ArrowRight size={14} aria-hidden="true" />
  </button>
);

