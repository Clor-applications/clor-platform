/**
 * Round 58 picks, the employee app on a phone (DESIGN.md, Round 58): the plain
 * rules behind the screens, kept here so they can be tested without a page.
 *
 * - "androidback" A: the phone's Back closes an open sheet or panel first.
 * - "aftersend" A: after sending, say who has it and what happens next.
 * - "punchdone" A: the tick screen's words ("In at 9:42 AM").
 * - "installapp" A: ask to add CLOR to the home screen from the second visit.
 * - "phonedate" / "rangetap" A: one month calendar, tap the first day then the last.
 * - "payslipbundle" A: the last 3, 6 or 12 payslips in one file.
 */
import { useEffect, useRef } from 'react';

/**
 * While `open`, the phone's Back closes the sheet instead of leaving the page.
 * Opening adds one history entry at the same address; Back pops it and closes
 * the sheet. Closing any other way takes that entry back off, so the next Back
 * still goes back a page. Nested sheets close one at a time, topmost first.
 */
export function useBackClose(open, onClose) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open || typeof window === 'undefined' || !window.history?.pushState) return undefined;
    const id = `s${Math.random().toString(36).slice(2)}`;
    try {
      window.history.pushState({ ...(window.history.state || {}), clorSheet: id }, '', window.location.href);
    } catch {
      return undefined;
    }
    let popped = false;
    const onPop = () => {
      /* Our entry is gone once the state no longer names it; a sheet opened above ours pops first. */
      if (window.history.state?.clorSheet === id) return;
      if (popped) return;
      popped = true;
      closeRef.current?.();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped && window.history.state?.clorSheet === id) {
        try { window.history.back(); } catch { /* history unavailable */ }
      }
    };
  }, [open]);
}

/**
 * "With Priya Menon (your manager)" from the server becomes "Sent to Priya
 * Menon (your manager)." plus what happens next. Never names a gender.
 */
export function sentWords(withWhom) {
  const w = String(withWhom || '').trim();
  const who = /^With /.test(w) ? `Sent to ${w.slice(5)}.` : 'Sent.';
  return `${who} You will get a notice when it is decided.`;
}

/** "09:42" → "9:42 AM"; "17:05" → "5:05 PM". Anything else is shown as given. */
export function clock12(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m) return String(hhmm || '');
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The tick screen's two lines after a saved punch. */
export function punchDoneLines(res, shiftStart) {
  const first = `${res?.kind === 'IN' ? 'In' : 'Out'} at ${clock12(res?.time)}`;
  const second = [res?.site || (res?.outside ? 'Outside the work sites' : ''), res?.kind === 'IN' && shiftStart ? `Shift ${clock12(shiftStart)}` : ''].filter(Boolean).join(' · ');
  return { first, second };
}

/* ---------------------------------------------------------------- installapp */

const VISITS = 'clor.portal.visits';
const NO_INSTALL = 'clor.portal.noInstall';
const store = () => { try { return window.localStorage; } catch { return null; } };

/** Counts this visit (once per page load) and returns how many there have been. */
export function countVisit(s = store()) {
  if (!s) return 0;
  try {
    const n = (Number(s.getItem(VISITS)) || 0) + 1;
    s.setItem(VISITS, String(n));
    return n;
  } catch { return 0; }
}

/** Whether to show "Add CLOR to your home screen": from the second visit, not once dismissed or installed. */
export function shouldAskInstall({ visits, standalone, dismissed }) {
  return visits >= 2 && !standalone && !dismissed;
}

export const installDismissed = (s = store()) => { try { return s?.getItem(NO_INSTALL) === '1'; } catch { return false; } };
export const dismissInstall = (s = store()) => { try { s?.setItem(NO_INSTALL, '1'); } catch { /* storage unavailable */ } };

/** Already opened from the home screen. */
export function isStandalone(w = typeof window !== 'undefined' ? window : null) {
  if (!w) return false;
  try {
    return Boolean(w.matchMedia?.('(display-mode: standalone)').matches || w.navigator?.standalone);
  } catch { return false; }
}

/** iPhone and iPad Safari have no install prompt: they need the Share steps. */
export const isIos = (ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') => /iPhone|iPad|iPod/i.test(ua);

/* ---------------------------------------------------------------- calendar */

const iso = (d) => d.toISOString().slice(0, 10);

/** The weeks of a month, Monday first; days outside the month are null. */
export function monthWeeks(ym) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => iso(new Date(Date.UTC(y, m - 1, i + 1))))];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function shiftMonth(ym, by) {
  const [y, m] = ym.split('-').map(Number);
  return iso(new Date(Date.UTC(y, m - 1 + by, 1))).slice(0, 7);
}

/**
 * One tap on the calendar. The first tap sets the first day; the second, on or
 * after it, sets the last day; a tap before the first day starts again from
 * there; a tap once both are set starts a new span. One-day types take one tap.
 */
export function tapDay({ from, to }, day, single = false) {
  if (single) return { from: day, to: '' };
  if (!from || to) return { from: day, to: '' };
  if (day < from) return { from: day, to: '' };
  return { from, to: day };
}

/** Whether a day sits inside the chosen span (the ends included). */
export const inSpan = (day, from, to) => Boolean(day && from && day >= from && day <= (to || from));

/* ---------------------------------------------------------------- payslips */

/** The newest `n` payslips (the list comes newest first). */
export const lastSlips = (slips, n) => (slips || []).slice(0, Math.max(0, n));

/** The bundle choices that make sense for how many payslips there are. */
export function bundleChoices(count) {
  const out = [3, 6, 12].filter((n) => n <= count);
  if (count > 1 && !out.includes(count) && count < 12) out.push(count);
  return out.sort((a, b) => a - b);
}

/** The file name the browser gives the PDF: "Payslips Apr 2026 to Sep 2026". */
export function bundleTitle(slips, code = '') {
  if (!slips.length) return 'Payslips';
  const newest = slips[0].period;
  const oldest = slips[slips.length - 1].period;
  return `Payslips ${oldest === newest ? newest : `${oldest} to ${newest}`}${code ? ` ${code}` : ''}`;
}
