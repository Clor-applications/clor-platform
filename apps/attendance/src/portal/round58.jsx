/**
 * Round 58 picks in the employee app (DESIGN.md, Round 58): the home-screen
 * strip, the leave calendar, asking about a payslip and payslips in one file.
 * The plain rules live in @ui/picks/round58 and are tested there.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Smartphone, X } from '@ui/components/ui/lineIcons';
import {
  bundleChoices, bundleTitle, countVisit, dismissInstall, inSpan, installDismissed, isIos, isStandalone,
  lastSlips, monthWeeks, shiftMonth, shouldAskInstall, tapDay,
} from '@ui/picks/round58';
import { errorWords } from '@ui/utils/errorWords';

/* ---------------------------------------------------------------- installapp A */

/* One count per page load, however often Today mounts. */
let visitsThisLoad = null;

/**
 * "Add CLOR to your home screen", from the second visit. Android Chrome offers
 * its own install sheet (the page keeps the browser's prompt until asked);
 * iPhone Safari has none, so the strip says where the Share button's step is.
 * Dismissed once, it never comes back on this phone.
 */
export function AddToHome() {
  const [visits] = useState(() => {
    if (visitsThisLoad == null) visitsThisLoad = countVisit();
    return visitsThisLoad;
  });
  const [prompt, setPrompt] = useState(null);
  const [gone, setGone] = useState(() => installDismissed() || isStandalone());
  useEffect(() => {
    const keep = (e) => { e.preventDefault(); setPrompt(e); };
    const installed = () => setGone(true);
    window.addEventListener('beforeinstallprompt', keep);
    window.addEventListener('appinstalled', installed);
    return () => { window.removeEventListener('beforeinstallprompt', keep); window.removeEventListener('appinstalled', installed); };
  }, []);
  const ios = isIos();
  if (!shouldAskInstall({ visits, standalone: false, dismissed: gone })) return null;
  if (!prompt && !ios) return null;
  const close = () => { dismissInstall(); setGone(true); };
  const add = async () => {
    try {
      prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === 'accepted') close();
    } catch { /* the browser said no */ }
    setPrompt(null);
  };
  return (
    <section className="ui-install-strip" aria-label="Add CLOR to your home screen">
      <Smartphone size={20} aria-hidden="true" className="shrink-0" />
      <p className="min-w-0 flex-1 text-sm">
        <strong>Add CLOR to your home screen</strong>
        <span className="ui-caption block">{ios ? 'Tap the Share button, then “Add to Home Screen”.' : 'Open it in one tap, like any app.'}</span>
      </p>
      {prompt ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={add}>Add</button> : null}
      <button type="button" className="ui-icon-btn" aria-label="Not now" onClick={close}><X size={16} aria-hidden="true" /></button>
    </section>
  );
}

/* ---------------------------------------------------------------- phonedate A + rangetap A */

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayName = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/**
 * CLOR's own month calendar for leave dates: holidays and weekly offs marked,
 * so the person sees which days count before sending. Tap the first day, then
 * the last; the days between light up. The date boxes below stay, for typing.
 * `loadMonth(ym)` returns the month's days ({ date, kind, holiday }) — the
 * employee's own schedule; without it the calendar still picks dates.
 */
export function LeaveCalendar({ from, to, single = false, onChange, loadMonth, today }) {
  const [ym, setYm] = useState(() => (from || today || new Date().toISOString().slice(0, 10)).slice(0, 7));
  const [marks, setMarks] = useState({});
  const asked = useRef(new Set());
  /* Follow a date typed in the boxes (adjusted while rendering, not in an effect). */
  const [seenFrom, setSeenFrom] = useState(from);
  if (from !== seenFrom) {
    setSeenFrom(from);
    if (from && from.slice(0, 7) !== ym) setYm(from.slice(0, 7));
  }
  useEffect(() => {
    if (!loadMonth || asked.current.has(ym)) return;
    asked.current.add(ym);
    let p;
    try { p = loadMonth(ym); } catch { return; }
    Promise.resolve(p).then((d) => {
      const m = {};
      for (const day of d?.days || []) if (day.kind === 'HOLIDAY' || day.kind === 'OFF') m[day.date] = { kind: day.kind, name: day.holiday || '' };
      setMarks((was) => ({ ...was, ...m }));
    }).catch(() => { asked.current.delete(ym); });
  }, [ym, loadMonth]);
  const weeks = useMemo(() => monthWeeks(ym), [ym]);
  const tap = (d) => {
    const next = tapDay({ from, to }, d, single);
    onChange(next);
  };
  const hint = single ? 'Tap the day.' : !from || to ? 'Tap your first day, then your last.' : 'Now tap your last day (or the same day for one day).';
  const holidaysHere = weeks.flat().filter((d) => d && marks[d]?.kind === 'HOLIDAY');
  return (
    <div className="ui-leave-cal" role="group" aria-label="Pick dates on a calendar">
      <div className="ui-leave-cal-head">
        <button type="button" className="ui-icon-btn" aria-label="Previous month" onClick={() => setYm(shiftMonth(ym, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
        <span className="text-sm font-medium" aria-live="polite">{monthName(ym)}</span>
        <button type="button" className="ui-icon-btn" aria-label="Next month" onClick={() => setYm(shiftMonth(ym, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
      </div>
      <p className="ui-caption">{hint}</p>
      <table className="ui-leave-cal-grid">
        <thead><tr>{WEEKDAYS.map((w) => <th key={w} scope="col" className="ui-caption">{w}</th>)}</tr></thead>
        <tbody>
          {weeks.map((wk, i) => (
            <tr key={i}>
              {wk.map((d, j) => {
                if (!d) return <td key={j} />;
                const mark = marks[d];
                const picked = inSpan(d, from, single ? '' : to);
                const end = d === from || (!single && d === to);
                const words = `${dayName(d)}${mark?.kind === 'HOLIDAY' ? `, holiday${mark.name ? `: ${mark.name}` : ''}` : mark?.kind === 'OFF' ? ', weekly off' : ''}${d === today ? ', today' : ''}`;
                return (
                  <td key={j}>
                    <button
                      type="button"
                      className="ui-leave-cal-day"
                      data-picked={picked || undefined}
                      data-end={end || undefined}
                      data-mark={mark?.kind?.toLowerCase()}
                      data-today={d === today || undefined}
                      aria-pressed={picked}
                      aria-label={words}
                      onClick={() => tap(d)}
                    >
                      {Number(d.slice(8))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ui-leave-cal-key ui-caption">
        <span><i data-mark="holiday" aria-hidden="true" /> Holiday</span>
        <span><i data-mark="off" aria-hidden="true" /> Weekly off</span>
        <span>Neither counts as leave</span>
      </p>
      {holidaysHere.length ? <p className="ui-caption">{holidaysHere.map((d) => `${Number(d.slice(8))} ${marks[d].name || 'Holiday'}`).join(' · ')}</p> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- payslipquery A */

/**
 * "Ask about this payslip": pick the line (or the whole payslip), say what is
 * wrong, and the question goes to HR with the month and the line in it — no
 * screenshot. `onAsk` hands a filled question to Ask HR below.
 */
export function PayslipAsk({ slip, onAsk }) {
  const [open, setOpen] = useState(false);
  const [line, setLine] = useState('');
  const [what, setWhat] = useState('');
  const lines = [...(slip.earnings || []).map((l) => l.name), ...(slip.deductions || []).map((l) => l.name)];
  if (!onAsk) return null;
  if (!open) return <button type="button" className="ui-btn ui-btn-secondary w-full" onClick={() => setOpen(true)}>Ask about this payslip</button>;
  const send = (e) => {
    e.preventDefault();
    const about = line || 'the whole payslip';
    onAsk({
      category: 'PAYROLL',
      subject: `Payslip ${slip.period}: ${line || 'question'}`.slice(0, 120),
      description: `About my payslip for ${slip.period}${slip.number ? ` (${slip.number})` : ''}, ${about}: ${what.trim()}`,
    });
    setOpen(false);
    setLine('');
    setWhat('');
  };
  return (
    <form className="ui-slip-ask space-y-3" onSubmit={send} aria-label="Ask about this payslip">
      <label className="block">
        <span className="ui-label">Which line?</span>
        <select className="ui-select w-full" value={line} onChange={(e) => setLine(e.target.value)}>
          <option value="">The whole payslip</option>
          {lines.map((n, i) => <option key={`${i}:${n}`} value={n}>{n}</option>)}
          <option value="Something missing">Something missing</option>
        </select>
      </label>
      <label className="block">
        <span className="ui-label">What looks wrong?</span>
        <textarea className="ui-input w-full" rows={3} required minLength={3} maxLength={1000} value={what} onChange={(e) => setWhat(e.target.value)} placeholder="e.g. My overtime of 6 hours is not on it." />
      </label>
      <p className="ui-caption">HR gets the month and the line with your question.</p>
      <div className="flex gap-2">
        <button type="submit" className="ui-btn ui-btn-primary flex-1">Ask HR</button>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- payslipbundle A */

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* Printed documents are black on white whatever the theme (DESIGN.md print exemption): literal colours. */
const BUNDLE_CSS = `
@media screen { .clor-slip-bundle { display: none; } }
@media print {
  body * { visibility: hidden !important; }
  .clor-slip-bundle, .clor-slip-bundle * { visibility: visible !important; }
  .clor-slip-bundle { position: absolute; left: 0; top: 0; width: 100%; background: #fff; color: #000; font: 12px/1.5 Figtree, system-ui, sans-serif; font-variant-numeric: tabular-nums; }
  .clor-slip-bundle section { padding: 24px; page-break-after: always; break-after: page; }
  .clor-slip-bundle section:last-child { page-break-after: auto; break-after: auto; }
  .clor-slip-bundle h1 { font-size: 18px; font-weight: 700; margin: 0; }
  .clor-slip-bundle table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  .clor-slip-bundle th, .clor-slip-bundle td { padding: 4px 0; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
  .clor-slip-bundle .amt { text-align: right; }
  .clor-slip-bundle .tot td { font-weight: 600; border-bottom: 1px solid #000; }
  .clor-slip-bundle .muted { color: #444; }
}`;

function BundleSheet({ slip: s }) {
  const e = s.employee || {};
  const who = [['Name', e.name], ['Employee code', e.code], ['Designation', e.designation], ['PAN', e.pan], ['UAN', e.uan], ['Bank', [e.bank, e.account].filter(Boolean).join(' ')]].filter(([, v]) => v);
  const rows = Math.max(s.earnings.length, s.deductions.length);
  return (
    <section>
      <h1>{s.company || 'Payslip'}</h1>
      <div className="muted">Payslip for {s.period}{s.number ? ` · ${s.number}` : ''}</div>
      <table><tbody>{who.map(([k, v]) => <tr key={k}><td className="muted">{k}</td><td>{v}</td></tr>)}{s.days ? <tr><td className="muted">Days paid</td><td>{s.days.payable} of {s.days.working}</td></tr> : null}</tbody></table>
      <table>
        <thead><tr><th>Earnings</th><th className="amt">Amount</th><th>Deductions</th><th className="amt">Amount</th></tr></thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              <td>{s.earnings[i]?.name || ''}</td><td className="amt">{s.earnings[i] ? money(s.earnings[i].amount) : ''}</td>
              <td>{s.deductions[i]?.name || ''}</td><td className="amt">{s.deductions[i] ? money(s.deductions[i].amount) : ''}</td>
            </tr>
          ))}
          <tr className="tot"><td>Total earnings</td><td className="amt">{money(s.gross)}</td><td>Total deductions</td><td className="amt">{money(s.totalDeductions)}</td></tr>
          <tr className="tot"><td colSpan={3}>Take-home pay</td><td className="amt">{money(s.net)}</td></tr>
        </tbody>
      </table>
      <p className="muted">From CLOR. PAN and bank account show only their last digits.</p>
    </section>
  );
}

/**
 * Payslips for a bank loan: choose the last 3, 6 or 12 months and save them as
 * one PDF, one payslip a page (the browser's "Save as PDF").
 */
export function PayslipBundle({ slips, load }) {
  const choices = bundleChoices(slips?.length || 0);
  const [n, setN] = useState(choices.includes(6) ? 6 : choices[choices.length - 1] || 0);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(null);
  const [failed, setFailed] = useState('');
  const print = useCallback((full) => {
    setReady(full);
    const was = document.title;
    document.title = bundleTitle(full, full[0]?.employee?.code || '');
    const back = () => { document.title = was; setReady(null); window.removeEventListener('afterprint', back); };
    window.addEventListener('afterprint', back);
    /* The sheets must be on the page before the print dialog reads it. */
    setTimeout(() => window.print(), 50);
  }, []);
  if (choices.length < 1) return null;
  const save = async () => {
    setFailed('');
    setBusy(true);
    try {
      const full = await Promise.all(lastSlips(slips, n).map((s) => load(s.id).then((d) => d.slip)));
      print(full);
    } catch (e) {
      if (e?.name !== 'SignedOut') setFailed(errorWords(e, 'put the payslips together'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ui-slip-bundle">
      <h3 className="ui-label">For a bank or a loan</h3>
      <div className="flex flex-wrap items-center gap-2">
        <div className="ui-seg" role="radiogroup" aria-label="How many payslips">
          {choices.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={n === c} className="ui-seg-btn" data-on={n === c || undefined} onClick={() => setN(c)}>Last {c}</button>
          ))}
        </div>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={save} disabled={busy}>{busy ? 'Putting together…' : 'Save as one PDF'}</button>
      </div>
      {failed ? <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{failed}</p> : null}
      {ready ? createPortal(<div className="clor-slip-bundle" aria-hidden="true"><style>{BUNDLE_CSS}</style>{ready.map((s, i) => <BundleSheet key={i} slip={s} />)}</div>, document.body) : null}
    </div>
  );
}
