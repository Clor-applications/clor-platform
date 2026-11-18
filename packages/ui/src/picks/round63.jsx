import React, { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/*
 * Round 63 picks (owner, 18 Nov 2026): reports.
 *
 * - columnhelp A: hover or tap a column name for one line on how it is worked out.
 * - negformat A: a minus amount reads "−1,200" in red, the sign before the figure.
 * - hidezero A: rows that are all zero wait behind "Show N people with none".
 * - reportpeek A: the first 20 rows on screen with the total count, then Download.
 * - reportheader A: a downloaded report starts with company, report, period, filters, made on and by whom.
 * - reportpdf A: Print lays the report out landscape, headers on every page, page numbers, totals last.
 * - reportrecent A: "Used recently" on top of the reports page, with the period last picked.
 */

/** One line per column name that is not plain on its own. Keyed by the label the reader sees. */
export const COLUMN_HELP = {
  'At start': 'People working here on the first day of the period.',
  'At end': 'People working here on the last day of the period.',
  Joiners: 'People whose first day falls in the period.',
  Leavers: 'People whose last day falls in the period.',
  'Average headcount': 'The average of the people working here across the period.',
  Attrition: 'Leavers in the period as a share of the average headcount.',
  'Last 12 months': 'Leavers in the 12 months to this one, as a share of the average headcount over them.',
  'Days left': 'Days from today to the date. A minus means the date has passed.',
  'Probation ends': 'Joining date plus the probation length set for the person.',
  'Confirmed on': 'The day the person was confirmed after probation.',
  'Contract ends': 'The last day of the person’s current contract.',
  'Valid until': 'The last day the document is good for.',
  Total: 'The sum of the columns to the left.',
  Gross: 'Every earning on the payslip before deductions.',
  Deductions: 'PF, ESI, professional tax, income tax and any recoveries taken from pay.',
  'Net pay': 'Gross minus deductions: what reaches the bank.',
  'Take-home': 'Gross minus deductions: what reaches the bank.',
  'Payable days': 'Days in the month minus unpaid days.',
  'Unpaid days (LOP)': 'Days not paid: absent without leave, or unpaid leave taken.',
  'Days to decide': 'Days from asking to the decision, counting weekends.',
};

export const helpFor = (label, own) => own || COLUMN_HELP[String(label || '').trim()] || '';

/** A column name with its one-line explanation: dotted underline, shown on hover or on tap (focus). */
export function ColumnName({ label, help }) {
  const text = helpFor(label, help);
  if (!text) return <>{label}</>;
  return (
    <span className="ui-colhelp" tabIndex={0} data-help={text} title={text} aria-description={text}>{label}</span>
  );
}

/** A figure as a report shows it: a minus before the figure ("−1,200"), in red. */
export function signedFigure(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { text: value, negative: false };
  if (value < 0) return { text: `−${Math.abs(value).toLocaleString('en-IN')}`, negative: true };
  return { text: value.toLocaleString('en-IN'), negative: false };
}

/**
 * True when every figure in the row is zero (and there is at least one figure). Words such as a name, an
 * employee ID or a department do not count; a words-for-a-figure cell ("Fewer than 5") does, as not zero.
 */
export function allZero(row, columns) {
  let numbers = 0;
  for (const c of columns.slice(1)) {
    /* "0 days left" is due today, not nothing: a countdown never makes a row empty. */
    if (c.key === 'days' || /days left/i.test(String(c.label || ''))) continue;
    const v = row[c.key];
    if (typeof v === 'number') { numbers += 1; if (v !== 0) return false; } else if (c.align === 'right' && v !== null && v !== undefined && v !== '' && v !== '—') return false;
  }
  return numbers > 0;
}

/**
 * Rows to draw: all-zero rows held back (unless every row is zero), and only the first `peek` until Show all.
 * Returns { visible, hiddenZero, total, more }.
 */
export function shapeRows(rows, columns, { showZero = false, showAll = false, peek = 20 } = {}) {
  const zero = rows.filter((r) => allZero(r, columns));
  const holdZero = !showZero && zero.length > 0 && zero.length < rows.length;
  const kept = holdZero ? rows.filter((r) => !allZero(r, columns)) : rows;
  const visible = showAll || kept.length <= peek ? kept : kept.slice(0, peek);
  return { visible, hiddenZero: holdZero ? zero.length : 0, total: kept.length, more: kept.length - visible.length };
}

const fmtDay = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(iso);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** The lines a download starts with, so the file stands on its own when it reaches the CA. */
export function reportHeaderLines({ company, report, from, to, filters = [], by, today = new Date() }) {
  const period = from && to ? `${fmtDay(from)} to ${fmtDay(to)}` : to ? `As of ${fmtDay(to)}` : '';
  const made = `Made on ${today.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}${by ? ` by ${by}` : ''}`;
  return [company, report, period ? `Period: ${period}` : '', filters.length ? `Filters: ${filters.join('; ')}` : 'Filters: none', made].filter(Boolean);
}

const csvCell = (s) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The server's CSV with the header lines on top (after the byte-order mark Excel reads for ₹ and names). */
export function withHeaderLines(csv, lines) {
  const text = String(csv || '');
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = bom ? text.slice(1) : text;
  return `${bom}${lines.map(csvCell).join('\r\n')}\r\n\r\n${body}`;
}

/** Print this report landscape: marks the page, shows every row first, then prints. */
export function printReport(beforePrint) {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  if (beforePrint) flushSync(beforePrint);
  root.dataset.printing = 'report';
  const done = () => { delete root.dataset.printing; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

/** Show every row while the page prints, however printing started (Print button or Ctrl+P). */
export function usePrintAll(setAll) {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const before = () => flushSync(() => setAll(true));
    window.addEventListener('beforeprint', before);
    return () => window.removeEventListener('beforeprint', before);
  }, [setAll]);
}

/* "Used recently": which report and the period last picked, in this browser only. No names, no figures. */
const RECENT_KEY = 'clor.reports.recent';
export function readRecentReports() {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.slice(0, 4) : []; } catch { return []; }
}
export function noteRecentReport({ id, from = '', to = '' }) {
  if (!id) return;
  try {
    const next = [{ id, from, to }, ...readRecentReports().filter((r) => r.id !== id)].slice(0, 4);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* convenience only */ }
}

/** The period as a short word: "Oct 2026" for a whole month, "FY 2026–27", or the two days. */
export function periodWord(from, to) {
  if (!from && to) return `as of ${fmtDay(to)}`;
  if (!from || !to) return '';
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const lastDay = new Date(ty, tm, 0).getDate();
  if (fd === 1 && td === lastDay && fy === ty && fm === tm) return new Date(fy, fm - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  if (fd === 1 && fm === 4 && tm === 3 && td === 31 && ty === fy + 1) return `FY ${fy}–${String(ty).slice(2)}`;
  return `${fmtDay(from)} to ${fmtDay(to)}`;
}

/** "Show N people with none" and "20 of N shown · Show all N", under a report table. */
export function RowsMore({ hiddenZero, more, total, shownCount, person, onShowZero, onShowAll }) {
  if (!hiddenZero && !more) return null;
  const noun = person ? 'people' : 'rows';
  return (
    <div className="ui-report-more">
      {more ? (
        <span className="ui-caption tabular-nums">{shownCount} of {total} shown · <button type="button" className="ui-link" onClick={onShowAll}>Show all {total}</button></span>
      ) : null}
      {hiddenZero ? (
        <button type="button" className="ui-link" onClick={onShowZero}>Show {hiddenZero} {hiddenZero === 1 ? (person ? 'person' : 'row') : noun} with none</button>
      ) : null}
    </div>
  );
}

export function useRowShape() {
  const [showZero, setShowZero] = useState(false);
  const [showAll, setShowAll] = useState(false);
  usePrintAll(setShowAll);
  return { showZero, setShowZero, showAll, setShowAll };
}
