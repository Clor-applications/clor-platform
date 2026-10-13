import React, { useRef, useState } from 'react';
import { ChevronDown, Download, FileText, MoreVertical, Search, SlidersHorizontal, Table2, X } from 'lucide-react';

import Popover from '../ui/Popover';
import { formatMoney } from '../../utils/money';
import { exportRows } from '../ListToolbar';
import { LIST_PERIODS, describeView } from '../../utils/listPeriod';
import { exportListPdf } from '../../utils/listPdf';
import { exportListXlsx } from '../../utils/listXlsx';

/**
 * The parts every document list page is built from.
 *
 * Invoices, bills, receipts and payments are the same screen with different
 * nouns: five figures, status tabs with counts, a table, paging, one tip. They
 * were about to be written four times, and four copies drift — the status
 * filter ends up in a different place on each, and the export means something
 * different on two of them.
 *
 * These are parts rather than one page component. A bill is not an invoice and
 * should not be forced through a single template; what they share is where
 * things sit and how they behave, not what they contain.
 */

/**
 * The row of figures across the top. Balances, so they say "as of" nothing.
 *
 * The icon sits in the corner rather than in front of the figure. In a row it
 * took 52px of the card, and a lakh-scale rupee amount needs about 155px at
 * this size — so on a five-across grid the value had 96px and every card on
 * every one of these pages rendered "₹41,01,992." with the rest clipped off.
 * A truncated amount on an accounting screen does not read as a layout bug, it
 * reads as the wrong number. Only the label clears the icon; the figure gets
 * the full width of the card and drops a step in size, which fits a crore at
 * the narrowest column the five-across grid produces.
 */
/**
 * The eight tones a Sales surface speaks in. A card naming one of these takes
 * the status palette, so the Paid card is the same green as the Paid pill and
 * the Paid tab; anything else keeps the older generic tokens, which is what
 * the modules that have not been migrated still pass.
 */
const SALES_TONES = new Set(['draft', 'sent', 'partial', 'paid', 'outstanding', 'overdue', 'cancelled', 'refund']);
const toneVars = (tone) =>
  SALES_TONES.has(tone)
    ? { wash: `rgb(var(--st-${tone}-strong))`, ink: `rgb(var(--st-${tone}-ink))`, figure: `rgb(var(--st-${tone}-ink))` }
    : {
        wash: `rgb(var(--${tone}) / 0.12)`,
        ink: `rgb(var(--${tone}))`,
        figure: tone === 'neg' || tone === 'warn' ? `rgb(var(--${tone}))` : undefined,
      };

export function StatCards({ cards, company, dense = false }) {
  const shown = cards.filter(Boolean);
  /*
   * The hint line was a default reading "This financial year" on every card of
   * every list. It cost a line of height five times over, and once the figures
   * started following the filters it was also wrong — filter to one customer
   * and the card is not showing the financial year at all. It is now only
   * rendered where a caller has something to say, and reserved across the row
   * when any card does, so the tiles stay the same height as each other.
   */
  const anyHint = shown.some((c) => c.hint);

  /* A card that names a destination is a control: rendered as a button —
     focusable, keyboard-operable — while a plain figure stays a div. Same
     tile either way. */
  const Tile = ({ card, children }) =>
    typeof card.onSelect === 'function' ? (
      <button
        type="button"
        onClick={card.onSelect}
        className={`ui-card px-3 flex items-center text-left w-full cursor-pointer ${dense ? 'py-1.5 gap-1.5' : 'py-2 gap-2'}`}
        aria-label={`${card.label} — open`}
      >
        {children}
      </button>
    ) : (
      <div className={`ui-card px-3 flex items-center ${dense ? 'py-1.5 gap-1.5' : 'py-2 gap-2'}`}>{children}</div>
    );

  return (
    <section className={`grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 ${dense ? 'gap-1.5' : 'gap-2'}`} aria-label="Summary">
      {shown.map((c) => (
        <Tile key={c.label} card={c}>
          {/* Beside the figure rather than floating in the corner. Absolute
              positioning was what forced the tile to be tall enough to have a
              corner to float in. */}
          <span
            className={`${dense ? 'h-6 w-6' : 'h-7 w-7'} rounded-lg grid place-items-center flex-shrink-0`}
            style={{ backgroundColor: toneVars(c.tone).wash, color: toneVars(c.tone).ink }}
            aria-hidden="true"
          >
            <c.Icon size={dense ? 14 : 15} />
          </span>

          <span className="block min-w-0">
            {/* One line, clipped rather than wrapped. Two-line labels forced a
                32px reservation on every card whether or not any label used it,
                and five of those across the top of a list is a band of empty
                space between the toolbar and the first invoice. */}
            <span className="ui-t-label block truncate" title={c.label}>
              {c.label}
            </span>
            <span
              className={`block truncate tabular-nums ${dense ? 'leading-5 text-sm' : 'leading-6 text-base'} ${c.count ? '' : 'ui-mono'}`}
      title={c.count ? String(c.value) : formatMoney(c.value, company)}
              style={toneVars(c.tone).figure ? { color: toneVars(c.tone).figure } : undefined}
            >
              {c.count ? String(c.value) : formatMoney(c.value, company)}
            </span>
            {anyHint ? (
              <span className="ui-subtle text-xs block leading-4 truncate">{c.hint || '\u00a0'}</span>
            ) : null}
          </span>
        </Tile>
      ))}
    </section>
  );
}

/**
 * Status as tabs with counts.
 *
 * The counts are the point: "Overdue 17" says there is something to do before
 * anything has been clicked. A tab showing 0 stays — one that appears and
 * disappears is a tab people stop trusting, and its absence is indistinguishable
 * from a bug.
 */
export function StatusTabs({ tabs, value, counts, onChange, children }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Status">
        {tabs.map((t) => {
          const on = value === t.value;
          return (
            <button
              key={t.value || 'all'}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(t.value)}
              className="ui-btn ui-btn-sm"
              style={
                on
                  ? { borderColor: 'rgb(var(--brand))', color: 'rgb(var(--brand-ink))', backgroundColor: 'rgb(var(--accent-soft))' }
                  : { borderColor: 'rgb(var(--border))', color: 'rgb(var(--fg-muted))' }
              }
            >
              {t.label}
              <span
                className="ui-mono text-xs rounded-full px-1.5"
                style={{
                  backgroundColor: on ? 'rgb(var(--brand) / 0.10)' : 'rgb(var(--surface-sunken))',
                  color: on ? 'rgb(var(--brand-ink))' : 'rgb(var(--fg))',
                }}
              >
                {counts[t.value] ?? 0}
              </span>
            </button>
          );
        })}
      </div>
      <div className="ms-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

/** Search, in the header rather than a band of its own. */
/**
 * Search is the control these pages exist for, so it is never the one that
 * gets dropped.
 *
 * It used to be `hidden md:block`. Below 768px the table is 960px wide inside
 * its own scroller and every column but the first is off-screen — which is
 * exactly where finding a document by name matters most, and exactly where the
 * search box disappeared. On a phone the only way to reach an invoice was to
 * scroll. It stays at every width now and takes the full row on small screens,
 * where there is nothing beside it to share with.
 */
export function ListSearch({ value, onChange, placeholder = 'Search…', label = 'Search' }) {
  return (
    <div className="relative order-first w-full md:order-none md:w-auto">
      <Search size={14} aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 ui-muted" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="ui-input w-full md:w-56 lg:w-64 ps-8 pe-2 text-sm"
      />
    </div>
  );
}

/** Period and Clear, behind a button that says how many filters are on. */
export function FiltersButton({ period, onPeriodChange, dateFrom, dateTo, onDateFromChange, onDateToChange, onClear, activeCount = 0 }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        ref={ref}
        onClick={() => setOpen((v) => !v)}
        className="ui-btn ui-btn-secondary"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <SlidersHorizontal size={16} aria-hidden="true" /> Filters
        {activeCount ? (
          <span className="ui-mono text-xs rounded-full px-1.5" style={{ backgroundColor: 'rgb(var(--brand))', color: '#fff' }}>
            {activeCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} minWidth={264}>
          <div className="p-3 space-y-3">
            <div>
              <label className="ui-label" htmlFor="list-period">Period</label>
              <select
                id="list-period"
                value={period}
                onChange={(e) => onPeriodChange(e.target.value)}
                className="ui-select w-full"
              >
                {LIST_PERIODS.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            </div>
            {period === 'custom' ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="ui-label" htmlFor="listpageparts-from">From</label>
                  <input id="listpageparts-from" type="date" value={dateFrom} onChange={(e) => onDateFromChange(e.target.value)} className="ui-input w-full px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="listpageparts-to">To</label>
                  <input id="listpageparts-to" type="date" value={dateTo} onChange={(e) => onDateToChange(e.target.value)} className="ui-input w-full px-2 py-1.5 text-sm" />
                </div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              className="ui-btn ui-btn-ghost ui-btn-sm w-full"
            >
              Clear all filters
            </button>
          </div>
        </Popover>
      ) : null}
    </div>
  );
}

/** Page-level actions. Never row actions — those belong on the row. */
export function MoreButton({ items, onSelect }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  /* Which submenu is showing. One at a time: two open lists in a menu this
     narrow is a scroll, not a choice. */
  const [openChild, setOpenChild] = useState('');
  return (
    <div className="relative">
      <button
        type="button"
        ref={ref}
        onClick={() => setOpen((v) => !v)}
        className="ui-btn ui-btn-secondary"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical size={16} aria-hidden="true" /> More
      </button>
      {open ? (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} minWidth={228}>
          <div className="py-1" role="menu">
            {items.filter(Boolean).map((o, i) =>
              o.sep ? (
                <div key={`s${i}`} className="my-1" style={{ borderTop: '1px solid rgb(var(--border))' }} />
              ) : (
                <React.Fragment key={o.key}>
                  {o.group ? <div className="ui-caption px-3 pb-1.5">{o.group}</div> : null}
                  <button
                    type="button"
                    role="menuitem"
                    aria-expanded={o.children ? openChild === o.key : undefined}
                    onClick={() => {
                      /* An entry with children asks a question; it does not
                         answer one. Closing the menu here would fire the
                         parent's own key and export in whatever format the
                         handler happened to default to. */
                      if (o.children?.length) {
                        setOpenChild((k) => (k === o.key ? '' : o.key));
                        return;
                      }
                      setOpen(false);
                      onSelect(o.key);
                    }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm hover:bg-[rgb(var(--surface-sunken))]"
                  >
                    {o.Icon ? <o.Icon size={16} aria-hidden="true" /> : null} {o.label}
                    {o.children?.length ? (
                      <ChevronDown
                        size={14}
                        aria-hidden="true"
                        className="ms-auto transition-transform"
                        style={openChild === o.key ? { transform: 'rotate(180deg)' } : undefined}
                      />
                    ) : null}
                  </button>
                  {o.children?.length && openChild === o.key
                    ? o.children.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpen(false);
                            setOpenChild('');
                            onSelect(c.key);
                          }}
                          className="w-full text-left flex items-center gap-2 px-3 py-2 ps-9 text-sm hover:bg-[rgb(var(--surface-sunken))]"
                        >
                          {c.Icon ? <c.Icon size={16} aria-hidden="true" /> : null} {c.label}
                        </button>
                      ))
                    : null}
                </React.Fragment>
              )
            )}
          </div>
        </Popover>
      ) : null}
    </div>
  );
}

/**
 * A split primary: the face does the common thing in one click, the caret
 * offers the less common ways in. When there is nothing else to offer it
 * renders as an ordinary button rather than a caret onto an empty menu.
 */
export function SplitPrimary({ label, options = [], onSelect, children }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  if (!options.length) return children;
  return (
    <span className="inline-flex">
      {children}
      <button
        type="button"
        ref={ref}
        onClick={() => setOpen((v) => !v)}
        className="ui-btn ui-btn-primary !rounded-s-none !px-2"
        style={{ borderInlineStart: '1px solid rgb(255 255 255 / 0.28)' }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More ways to create ${label}`}
      >
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open ? (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} minWidth={236}>
          <div className="py-1" role="menu">
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onSelect(o.key);
                }}
                className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm hover:bg-[rgb(var(--surface-sunken))]"
              >
                {o.Icon ? <o.Icon size={16} aria-hidden="true" /> : null} {o.label}
              </button>
            ))}
            {options.hint ? <p className="ui-caption px-3 pt-1 pb-2">{options.hint}</p> : null}
          </div>
        </Popover>
      ) : null}
    </span>
  );
}

/** PDF, Excel or CSV, over exactly the rows and columns on screen. */
export function ExportButton({ title, fileName, sheetName, columns, rows, subtitleParts = {}, label = '', metaLines = [], footerRows = [], reportStyle = 'default' }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const subtitle = describeView(subtitleParts);
  const common = { fileName, columns, rows, metaLines, footerRows, reportStyle };
  return (
    <div className="relative">
      <button
        type="button"
        ref={ref}
        onClick={() => setOpen((v) => !v)}
        className="ui-btn ui-btn-secondary ui-btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Export"
        title="Export"
      >
        <Download size={16} aria-hidden="true" /> {label}
      </button>
      {open ? (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} minWidth={216}>
          <div className="py-1" role="menu">
            {[
              { k: 'pdf', label: 'PDF', Icon: FileText },
              { k: 'xlsx', label: 'Excel', Icon: Table2 },
              { k: 'csv', label: 'CSV', Icon: Download },
            ].map((o) => (
              <button
                key={o.k}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  if (o.k === 'pdf') {
                    exportListPdf({ ...common, title, subtitle, footNote: `${rows.length} row(s) · exported from CLOR` });
                  } else if (o.k === 'xlsx') {
                    exportListXlsx({ ...common, subtitle, sheetName: sheetName || title });
                  } else {
                    exportRows({ ...common, prefixRows: metaLines.map((line) => [line]), label: 'row(s)' });
                  }
                }}
                className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm hover:bg-[rgb(var(--surface-sunken))]"
              >
                <o.Icon size={16} aria-hidden="true" /> {o.label}
              </button>
            ))}
            <p className="ui-caption px-3 pt-1 pb-2">Exports what you are looking at — this tab, this search, this period.</p>
          </div>
        </Popover>
      ) : null}
    </div>
  );
}

/**
 * Paging. Hidden when everything already fits, because a control that can only
 * do nothing is noise. The page window is five wide, so page 40 of 60 does not
 * render sixty buttons.
 */
export function Pagination({ total, page, perPage, pageCount, onPage, onPerPage, noun = 'rows' }) {
  if (total <= perPage && perPage === 10) return null;
  const first = Math.max(1, Math.min(page - 2, pageCount - 4));
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3" style={{ borderTop: '1px solid rgb(var(--border))' }}>
      <span className="ui-subtle text-xs">
        Showing {total === 0 ? 0 : (page - 1) * perPage + 1} to {Math.min(page * perPage, total)} of {total} {noun}
      </span>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button type="button" className="ui-btn ui-btn-sm" disabled={page === 1} onClick={() => onPage(1)} aria-label="First page">«</button>
        <button type="button" className="ui-btn ui-btn-sm" disabled={page === 1} onClick={() => onPage(page - 1)} aria-label="Previous page">‹</button>
        {Array.from({ length: Math.min(5, pageCount) }, (_, i) => first + i)
          .filter((n) => n >= 1 && n <= pageCount)
          .map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onPage(n)}
              aria-current={n === page ? 'page' : undefined}
              className="ui-btn ui-btn-sm ui-mono"
              style={n === page ? { borderColor: 'rgb(var(--brand))', color: 'rgb(var(--brand-ink))', backgroundColor: 'rgb(var(--accent-soft))' } : undefined}
            >
              {n}
            </button>
          ))}
        <button type="button" className="ui-btn ui-btn-sm" disabled={page === pageCount} onClick={() => onPage(page + 1)} aria-label="Next page">›</button>
        <button type="button" className="ui-btn ui-btn-sm" disabled={page === pageCount} onClick={() => onPage(pageCount)} aria-label="Last page">»</button>
        <select
          value={perPage}
          onChange={(e) => onPerPage(Number(e.target.value))}
          className="ui-select ui-btn-sm w-24 px-2 text-xs ui-ctl-compact"
          aria-label="Rows per page"
        >
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>{n} / page</option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** One tip, under the table, dismissed for good. */
export function ListTip({ storageKey, text, actionLabel, onAction, Icon }) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(storageKey) === 'dismissed');
  if (dismissed) return null;
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
      style={{ backgroundColor: 'rgb(var(--info-soft))', color: 'rgb(var(--fg))' }}
      role="note"
    >
      {Icon ? (
        <Icon size={14} aria-hidden="true" className="shrink-0" style={{ color: 'rgb(var(--info))' }} />
      ) : null}
      <span className="min-w-0 truncate" title={text}>{text}</span>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="ui-btn ui-btn-sm"
          style={{ borderColor: 'currentColor', color: 'inherit', backgroundColor: 'transparent' }}
        >
          {actionLabel}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => {
          localStorage.setItem(storageKey, 'dismissed');
          setDismissed(true);
        }}
        className="ui-btn ui-btn-ghost ui-btn-sm ms-auto"
        style={{ color: 'inherit' }}
        aria-label="Dismiss this tip"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Page slice plus a clamped page number, the arithmetic every list repeats. */
export function usePaged(rows, perPage, page) {
  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
  const safePage = Math.min(page, pageCount);
  return { pageCount, safePage, pageRows: rows.slice((safePage - 1) * perPage, safePage * perPage) };
}


/**
 * The strip of filters at the head of a list's table.
 *
 * Search and status live in the page header and the tabs; what is left is what
 * those two cannot say — a customer, a frequency, a date window. Written by
 * hand on the one list that needed it, it was the only list whose filters sat
 * at a different height and inside a different rule from everybody else's.
 */
export function ListFilterBand({ children }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-4 py-3"
      style={{ borderBottom: '1px solid rgb(var(--border))' }}
    >
      {children}
    </div>
  );
}
