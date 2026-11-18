/*
 * Round 60 picks (18 Nov 2026): clear words and getting unstuck.
 *
 * - toastwords A: the done message names the thing and the person ("Ravi Kumar’s leave, 4–6 Dec, approved").
 * - zerorows A: a payslip shows only the lines with an amount.
 * - abbrexplain A: PF, ESI, PT, TDS and friends carry a dotted underline; a tap gives the full name and one line.
 * - slowload A: after 5 seconds a slow report says it is still working, with Cancel where the screen can stop.
 * - lastsignin A: "Today", "3 days ago", "Never" for when someone last signed in.
 */
import React, { useEffect, useId, useRef, useState } from 'react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? { y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]) } : null;
};

/** "Ravi Kumar’s", "Suresh’" — the owner of the thing in a done message. */
export function possessive(name) {
  const n = String(name || '').trim();
  if (!n) return 'Their';
  return /s$/i.test(n) ? `${n}’` : `${n}’s`;
}

/** "4 Dec", "4–6 Dec", "30 Nov–2 Dec", "30 Dec 2026–2 Jan 2027". */
export function shortRange(from, to) {
  const a = parts(from);
  const b = parts(to) || a;
  if (!a) return '';
  if (a.y === b.y && a.mo === b.mo && a.d === b.d) return `${a.d} ${MONTHS[a.mo]}`;
  if (a.y === b.y && a.mo === b.mo) return `${a.d}–${b.d} ${MONTHS[a.mo]}`;
  if (a.y === b.y) return `${a.d} ${MONTHS[a.mo]}–${b.d} ${MONTHS[b.mo]}`;
  return `${a.d} ${MONTHS[a.mo]} ${a.y}–${b.d} ${MONTHS[b.mo]} ${b.y}`;
}

/** The done message after a decision: "Ravi Kumar’s leave, 4–6 Dec, approved". */
export function decidedLine({ name, what = 'request', from, to, verb }) {
  const when = shortRange(from, to);
  return `${possessive(name)} ${what}${when ? `, ${when}` : ''}, ${verb}`;
}

/** Payslip lines worth reading: a line of ₹0 (no overtime this month) is left out. */
export function shownLines(rows) {
  return (rows || []).filter((l) => Math.abs(Number(l?.amount) || 0) >= 0.005);
}

/** When someone last signed in, the way a person says it. */
export function lastSignedIn(at, now = new Date()) {
  if (!at) return 'Never';
  const t = new Date(at);
  if (Number.isNaN(t.getTime())) return 'Never';
  const day = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(now) - day(t)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 31) return `${days} days ago`;
  return t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The same as a sentence under a name: "Signed in today", "Signed in 3 days ago", "Never signed in". */
export function lastSignedInLine(at, now = new Date()) {
  const w = lastSignedIn(at, now);
  if (w === 'Never') return 'Never signed in';
  if (w === 'Today' || w === 'Yesterday') return `Signed in ${w.toLowerCase()}`;
  if (/days ago$/.test(w)) return `Signed in ${w}`;
  return `Last signed in ${w}`;
}

/** The short forms a new HR person meets on day one, each with its full name and one plain line. */
export const ABBR = {
  PF: ['Provident Fund', 'savings for retirement, paid by the person and the company'],
  EPF: ['Employees’ Provident Fund', 'the retirement savings part of PF'],
  EPS: ['Employees’ Pension Scheme', 'the pension part of the company’s PF share'],
  ESI: ['Employees’ State Insurance', 'medical cover for people earning up to ₹21,000 a month'],
  ESIC: ['Employees’ State Insurance Corporation', 'the body that runs ESI'],
  PT: ['Professional Tax', 'a small state tax taken from salary'],
  TDS: ['Tax Deducted at Source', 'income tax taken from salary each month'],
  LWF: ['Labour Welfare Fund', 'a small state fund for workers’ welfare'],
  UAN: ['Universal Account Number', 'the person’s PF number for life'],
  HRA: ['House Rent Allowance', 'part of salary for rent, partly tax-free'],
  LOP: ['Loss of pay', 'days not paid'],
  CTC: ['Cost to company', 'everything the company spends on the person in a year'],
  ECR: ['Electronic Challan cum Return', 'the monthly PF file'],
  PAN: ['Permanent Account Number', 'the income tax number'],
};

/** A short form with a dotted underline; a tap or a key press shows the full name and one line. */
export function Abbr({ k, children }) {
  const key = String(k || children || '').trim().toUpperCase();
  const entry = ABBR[key];
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!entry) return <>{children ?? k}</>;
  return (
    <span className="ui-abbr-wrap" ref={box}>
      <abbr
        className="ui-abbr"
        title={`${entry[0]}: ${entry[1]}`}
        tabIndex={0}
        role="button"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}
      >
        {children ?? key}
      </abbr>
      {open ? (
        <span role="tooltip" id={id} className="ui-abbr-tip">
          <strong>{key}</strong> · {entry[0]}, {entry[1]}
        </span>
      ) : null}
    </span>
  );
}

/** A payslip line name, with the short form explained when the whole name is one ("PF", "Professional Tax" stays as it is). */
export function lineName(name) {
  const n = String(name || '').trim();
  return ABBR[n.toUpperCase()] ? <Abbr k={n}>{n}</Abbr> : n;
}

/** True once something has been busy for `after` ms; resets when it stops. */
export function useSlow(busy, after = 5000) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) return undefined;
    const t = setTimeout(() => setSlow(true), after);
    return () => { clearTimeout(t); setSlow(false); };
  }, [busy, after]);
  return Boolean(busy && slow);
}

/** "Still working, big reports take up to a minute", shown only after 5 seconds, with Cancel when the screen can stop. */
export function SlowNote({ busy, onCancel, after = 5000 }) {
  const slow = useSlow(busy, after);
  if (!slow) return null;
  return (
    <p role="status" className="ui-slow-note">
      <span>Still working. Big reports take up to a minute.</span>
      {onCancel ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={onCancel}>Cancel</button> : null}
    </p>
  );
}
