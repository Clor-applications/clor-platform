import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft } from '@ui/components/ui/lineIcons';
import { confirmDialog } from '@ui/components/ui/notify';

import LoadFailed from '@ui/components/ui/LoadFailed';
import { lineName, shownLines } from '@ui/picks/round60';
import { SignedOut, askToStay, doneJourneyTask, getJourney, getLeaving, getMyDetails, getPayslip, getPayslips, raisePrivateCase, resign, todayIst } from './portalApi';
import { addDaysIso as addDays } from '@ui/utils/dates';
import { SPLIT_NOTE, SPLIT_TITLE, countWords, splitLines } from '@ui/picks/payLines';
import { useBackClose } from '@ui/picks/round58';
import { PayslipAsk, PayslipBundle } from './round58';
import { errorWords } from '@ui/utils/errorWords';

/**
 * The Me tab's pay and leaving pieces (EMPLOYEE-VIEW gaps 1, 3, 7, 8):
 * payslips with a printable copy, the salary-account card that hands over to
 * Ask HR, resigning from the app, and the private complaint form.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (d) => {
  const [y, m, dd] = String(d || '').slice(0, 10).split('-');
  return y && m && dd ? `${Number(dd)} ${MONTHS[Number(m) - 1]} ${y}` : '';
};
const errText = (e, what) => (e instanceof SignedOut ? '' : errorWords(e, what));
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------------------
// Payslips
// ---------------------------------------------------------------------------

/**
 * My payslips, newest first: period, take-home and whether it is paid. Opening
 * one shows its lines; Save as PDF prints a plain black-on-white copy (the
 * browser's "Save as PDF"). Says nothing where the company does not run
 * payroll in CLOR.
 */
export function Payslips({ guard, onAsk = null }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');
  const [open, setOpen] = useState(null);
  const [slip, setSlip] = useState(null);
  const [slipFailed, setSlipFailed] = useState('');
  const load = useCallback(() => {
    guard(getPayslips())
      .then((d) => { setData(d); setFailed(''); })
      .catch((e) => setFailed(errText(e, 'load your payslips')));
  }, [guard]);
  useEffect(() => { load(); }, [load]);
  const loadSlip = useCallback(() => {
    if (!open) return;
    guard(getPayslip(open))
      .then((d) => { setSlip(d.slip); setSlipFailed(''); })
      .catch((e) => setSlipFailed(errText(e, 'open this payslip')));
  }, [open, guard]);
  useEffect(() => { loadSlip(); }, [loadSlip]);
  /* Round 58 "androidback" A: the phone's Back returns from one payslip to the list. */
  const closeSlip = useCallback(() => { setOpen(null); setSlip(null); setSlipFailed(''); }, []);
  useBackClose(Boolean(open), closeSlip);
  const loadOne = useCallback((id) => guard(getPayslip(id)), [guard]);

  if (failed) return <LoadFailed message={failed} onRetry={load} />;
  if (!data?.available) return null;
  if (open) {
    return (
      <section className="ui-card space-y-3 p-5 ui-touch-44" aria-labelledby="slip-h">
        <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={closeSlip}>
          <ChevronLeft size={16} aria-hidden="true" /> All payslips
        </button>
        <LoadFailed message={slipFailed} onRetry={loadSlip} />
        {!slip && !slipFailed ? <p className="ui-caption">Loading the payslip…</p> : null}
        {slip ? <PayslipView slip={slip} onAsk={onAsk} /> : null}
      </section>
    );
  }
  return (
    <section className="ui-card p-5 ui-touch-44" aria-labelledby="slips-h">
      <h2 id="slips-h" className="ui-t-sec mb-1">Payslips</h2>
      {data.pfSaved ? <PfSaved pf={data.pfSaved} /> : null}
      {data.slips.length ? (
        <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
          {data.slips.map((s) => (
            <li key={s.id}>
              <button type="button" className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm" onClick={() => { setSlip(null); setSlipFailed(''); setOpen(s.id); }} aria-label={`Open payslip for ${s.period}${s.extraPayRun ? ' · Extra pay run' : ''}`}>
                <span className="min-w-0">
                  <span className="block font-medium">{s.period}{s.extraPayRun ? ' · Extra pay run' : ''}</span>
                  <span className={`ui-pill ${s.paid ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{s.paid ? 'Paid' : 'Not paid yet'}</span>
                </span>
                <span className="shrink-0 text-right tabular-nums">{money(s.net)}<span className="ui-caption block">net pay</span></span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ui-caption">No payslips yet. They appear here once HR closes a month’s payroll.</p>
      )}
      {data.slips.length > 1 ? <PayslipBundle slips={data.slips} load={loadOne} /> : null}
    </section>
  );
}

/** One payslip on screen, with Save as PDF. */
function PayslipView({ slip: s, onAsk = null }) {
  const save = () => {
    const was = document.title;
    /* The browser names the PDF after the page title. */
    document.title = `Payslip ${s.period}${s.employee.code ? ` ${s.employee.code}` : ''}`;
    const back = () => { document.title = was; window.removeEventListener('afterprint', back); };
    window.addEventListener('afterprint', back);
    window.print();
  };
  /* Two lines can share a name (two fines): keyed by place, not by name. */
  /* Round 60: only lines with an amount (zerorows A); PF, ESI, PT and TDS explained on a tap (abbrexplain A). */
  const lines = (rows) => shownLines(rows).map((l, i) => (
    <div key={`${i}:${l.name}`} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt>{lineName(l.name)}{countWords(l) ? <span className="ui-caption block tabular-nums">{countWords(l)}</span> : null}</dt>
      <dd className="text-right tabular-nums">{money(l.amount)}</dd>
    </div>
  ));
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="slip-h" className="ui-t-sec">Payslip · {s.period}</h2>
          <p className="ui-caption">{[s.company, s.number, s.extraPayRun ? 'Extra pay run' : ''].filter(Boolean).join(' · ')}</p>
        </div>
        <span className={`ui-pill shrink-0 ${s.paid ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{s.paid ? 'Paid' : 'Not paid yet'}</span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm">Net pay</span>
        <span className="text-2xl font-semibold tabular-nums">{money(s.net)}</span>
      </div>
      {s.days && !(s.extraPayRun && !s.days.working) ? <p className="ui-caption tabular-nums">{s.days.payable} of {s.days.working} days paid{s.days.lossOfPay ? ` · ${s.days.lossOfPay} without pay` : ''}</p> : null}
      {splitLines(s.split).length ? (
        <div aria-label={SPLIT_TITLE}>
          <h3 className="ui-label">{SPLIT_TITLE}</h3>
          {splitLines(s.split).map((t) => <p key={t} className="text-sm tabular-nums">{t}</p>)}
          <p className="ui-caption">{SPLIT_NOTE}</p>
        </div>
      ) : null}
      <div>
        <h3 className="ui-label">Earnings</h3>
        <dl className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
          {lines(s.earnings)}
          <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm font-medium"><dt>Total earnings</dt><dd className="text-right tabular-nums">{money(s.gross)}</dd></div>
        </dl>
      </div>
      <div>
        <h3 className="ui-label">Deductions</h3>
        <dl className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
          {shownLines(s.deductions).length ? lines(s.deductions) : <p className="ui-caption py-1.5">None</p>}
          <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm font-medium"><dt>Total deductions</dt><dd className="text-right tabular-nums">{money(s.totalDeductions)}</dd></div>
        </dl>
      </div>
      {s.pf ? <CompanyPf pf={s.pf} /> : null}
      <MovedOn note={s.deductionNote} leaving={s.leaving} />
      {s.sinceApril ? <SinceApril year={s.sinceApril} /> : null}
      <button type="button" className="ui-btn ui-btn-primary w-full" onClick={save}>Save as PDF</button>
      <p className="ui-caption">Choose “Save as PDF” as the printer. PAN and bank account show only their last digits.</p>
      <PayslipAsk slip={s} onAsk={onAsk} />
      <PayslipPrint slip={s} />
    </>
  );
}

/** A label-and-amount row, money right-aligned in tabular figures. */
const Row = ({ label, amount, strong = false }) => (
  <div className={`flex items-baseline justify-between gap-3 py-1.5 text-sm${strong ? ' font-medium' : ''}`}>
    <dt>{label}</dt>
    <dd className="text-right tabular-nums">{money(amount)}</dd>
  </div>
);

/**
 * The company's PF this month, under the employee's own PF: how much of it
 * went to the pension (EPS) and how much to the fund (EPF). Read from the
 * payslip as it was made; nothing is worked out again here.
 */
export function CompanyPf({ pf }) {
  if (!pf.pension && !pf.employer) return null;
  return (
    <div>
      <h3 className="ui-label">Company’s PF this month</h3>
      <dl className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
        {pf.employer ? <Row label="To your PF account (EPF)" amount={pf.employer} /> : null}
        {pf.pension ? <Row label="To your pension (EPS)" amount={pf.pension} /> : null}
      </dl>
      <p className="ui-caption">Paid by the company on top of your pay; not taken from it.</p>
    </div>
  );
}

/** This financial year so far, up to and including this payslip. */
export function SinceApril({ year }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: 'rgb(var(--border))' }}>
      <h3 className="ui-label">Since {longDate(year.from)}</h3>
      <dl className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
        <Row label="Pay" amount={year.gross} />
        <Row label="Income tax" amount={year.tax} />
        <Row label="Your PF" amount={year.pf} />
        <Row label="Take-home" amount={year.net} strong />
      </dl>
      <p className="ui-caption tabular-nums">{year.payslips} {year.payslips === 1 ? 'payslip' : 'payslips'} this financial year</p>
    </div>
  );
}

/**
 * PF put by in CLOR's payroll records. The fund's own balance can differ: PF
 * from an earlier job, and the interest the fund adds, are not known here.
 */
export function PfSaved({ pf }) {
  return (
    <div className="mb-3 rounded-xl border p-3" style={{ borderColor: 'rgb(var(--border))' }}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="ui-label">PF saved so far</h3>
        <span className="text-lg font-semibold tabular-nums">{money(pf.fund)}</span>
      </div>
      <dl className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
        <Row label="From your pay" amount={pf.employee} />
        <Row label="From the company" amount={pf.employer} />
        {pf.pension ? <Row label="Pension (EPS), kept separately" amount={pf.pension} /> : null}
      </dl>
      <p className="ui-caption">From {pf.payslips} {pf.payslips === 1 ? 'payslip' : 'payslips'} since {longDate(pf.since)}. Your PF account’s balance on the EPFO site also counts interest and any earlier job.</p>
    </div>
  );
}

/**
 * What this payslip could not take and moved on (deductionCap.ts), in the
 * employee's words; Payroll's slip shows the same note to HR. Somebody leaving
 * has no next payslip, so theirs goes to the full and final.
 */
export function MovedOn({ note, leaving = false }) {
  if (!note?.carried?.length) return null;
  const rest = leaving ? 'The rest goes to your full and final settlement.' : 'The rest comes off next month’s payslip.';
  const why = note.reason !== 'LIMIT'
    ? `This payslip had nothing left to take it from. ${rest}`
    : Number(note.counted) > Number(note.limit)
      ? `Instalments may take up to ${note.percent}% of your wages (${money(note.limit)} of ${money(note.wages)}), and other deductions already came to ${money(note.counted)}, so none was taken this month. ${leaving ? 'It goes to your full and final settlement.' : 'It comes off next month’s payslip.'}`
      : `Instalments may take up to ${note.percent}% of your wages (${money(note.limit)} of ${money(note.wages)}), counting other deductions. ${rest}`;
  return (
    <div>
      <h3 className="ui-label">{leaving ? 'Left for your full and final' : 'Moved to next month'}</h3>
      <dl className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
        {note.carried.map((c, i) => (
          <div key={`${i}:${c.label}`} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
            <dt>{c.label}</dt>
            <dd className="text-right tabular-nums">{money(c.amount)}</dd>
          </div>
        ))}
      </dl>
      <p className="ui-caption mt-1">{why}</p>
    </div>
  );
}

/*
 * The printed copy. A printed document is black on white whatever the app's
 * theme (DESIGN.md: print surfaces are exempt from the token rule), so its
 * colours are literal. On screen it is hidden; when printing, only it shows.
 */
const PRINT_CSS = `
@media screen { .clor-payslip-print { display: none; } }
@media print {
  body * { visibility: hidden !important; }
  .clor-payslip-print, .clor-payslip-print * { visibility: visible !important; }
  .clor-payslip-print { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; background: #fff; color: #000; font: 12px/1.5 'Inter Variable', Inter, system-ui, sans-serif; font-variant-numeric: tabular-nums; }
  .clor-payslip-print h1 { font-size: 18px; font-weight: 700; margin: 0; }
  .clor-payslip-print table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  .clor-payslip-print th, .clor-payslip-print td { padding: 4px 0; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
  .clor-payslip-print .amt { text-align: right; }
  .clor-payslip-print .tot td { font-weight: 600; border-bottom: 1px solid #000; }
  .clor-payslip-print .muted { color: #444; }
}`;

/** A printed line's name, with its count × rate when it has one: "Canteen (22 meals × ₹30)". */
const withCount = (l) => (countWords(l) ? `${l.name} (${countWords(l)})` : l.name);

function PayslipPrint({ slip: s }) {
  const e = s.employee;
  const who = [
    ['Name', e.name], ['Employee code', e.code], ['Designation', e.designation], ['Department', e.department],
    ['PAN', e.pan], ['UAN', e.uan], ['Bank', [e.bank, e.account].filter(Boolean).join(' ')],
  ].filter(([, v]) => v);
  const earn = shownLines(s.earnings);
  const ded = shownLines(s.deductions);
  const rows = Math.max(earn.length, ded.length);
  return createPortal(
    <div className="clor-payslip-print" aria-hidden="true">
      <style>{PRINT_CSS}</style>
      <h1>{s.company || 'Payslip'}</h1>
      <div className="muted">{s.extraPayRun ? 'Extra pay run' : 'Payslip'} for {s.period}{s.number ? ` · ${s.number}` : ''}{s.from && s.to ? ` · ${longDate(s.from)} to ${longDate(s.to)}` : ''}</div>
      <table>
        <tbody>
          {who.map(([k, v]) => <tr key={k}><td className="muted">{k}</td><td>{v}</td></tr>)}
          {s.days && !(s.extraPayRun && !s.days.working) ? <tr><td className="muted">Days paid</td><td>{s.days.payable} of {s.days.working}{s.days.lossOfPay ? `, ${s.days.lossOfPay} without pay` : ''}</td></tr> : null}
        </tbody>
      </table>
      <table>
        <thead><tr><th>Earnings</th><th className="amt">Amount</th><th>Deductions</th><th className="amt">Amount</th></tr></thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              <td>{earn[i] ? withCount(earn[i]) : ''}</td><td className="amt">{earn[i] ? money(earn[i].amount) : ''}</td>
              <td>{ded[i] ? withCount(ded[i]) : ''}</td><td className="amt">{ded[i] ? money(ded[i].amount) : ''}</td>
            </tr>
          ))}
          <tr className="tot"><td>Total earnings</td><td className="amt">{money(s.gross)}</td><td>Total deductions</td><td className="amt">{money(s.totalDeductions)}</td></tr>
          <tr className="tot"><td colSpan={3}>Net pay</td><td className="amt">{money(s.net)}</td></tr>
        </tbody>
      </table>
      {s.deductionNote?.carried?.length ? (
        <p className="muted">{s.leaving ? 'Left for the full and final' : 'Moved to next month'}: {s.deductionNote.carried.map((c) => `${c.label} ${money(c.amount)}`).join(', ')}.</p>
      ) : null}
      {s.pf && (s.pf.employer || s.pf.pension) ? (
        <p className="muted">Company’s PF this month, not taken from pay: to PF (EPF) {money(s.pf.employer)}, to pension (EPS) {money(s.pf.pension)}.</p>
      ) : null}
      {s.sinceApril ? (
        <table>
          <thead><tr><th colSpan={2}>Since {longDate(s.sinceApril.from)}</th></tr></thead>
          <tbody>
            <tr><td>Pay</td><td className="amt">{money(s.sinceApril.gross)}</td></tr>
            <tr><td>Income tax</td><td className="amt">{money(s.sinceApril.tax)}</td></tr>
            <tr><td>Your PF</td><td className="amt">{money(s.sinceApril.pf)}</td></tr>
            <tr className="tot"><td>Take-home</td><td className="amt">{money(s.sinceApril.net)}</td></tr>
          </tbody>
        </table>
      ) : null}
      <p className="muted">From CLOR. PAN and bank account show only their last digits.</p>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Pay: the salary account, until Payroll settles how a change is approved
// ---------------------------------------------------------------------------

export function PayCard({ onAsk }) {
  return (
    <section className="ui-card space-y-2 p-5" aria-labelledby="pay-h">
      <h2 id="pay-h" className="ui-t-sec">Pay</h2>
      <p className="text-sm">To change your salary account, ask HR. They check the new account before your next salary goes to it.</p>
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={onAsk}>Ask HR to change my account</button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Leaving the company
// ---------------------------------------------------------------------------

/**
 * Resign from the app (LIFE-05): the last working day, filled from the notice
 * the person's terms set, a reason, and a confirm. It goes to the manager and
 * HR; once it is with them, or a last day is on record, the form gives way to
 * where it stands (also shown under My job).
 */
export function LeavingCompany({ guard, refreshKey, onSent }) {
  const [state, setState] = useState(null);
  const [failed, setFailed] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ lastDay: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const load = useCallback(() => {
    Promise.all([guard(getLeaving()), guard(getMyDetails()).catch(() => null)])
      .then(([leaving, details]) => { setState({ leaving, noticeDays: details?.terms?.noticeDays ?? null }); setFailed(''); })
      .catch((e) => setFailed(errText(e, 'load whether you are leaving')));
  }, [guard]);
  useEffect(() => { load(); }, [load, refreshKey]);

  if (failed) return <LoadFailed message={failed} onRetry={load} />;
  if (!state) return null;
  const { leaving, noticeDays } = state;
  const t = todayIst();
  const earliest = noticeDays ? addDays(t, noticeDays) : '';
  const start = () => { setForm({ lastDay: earliest, reason: '' }); setNote(null); setOpen(true); };
  const send = async (e) => {
    e.preventDefault();
    const sure = await confirmDialog({
      title: 'Send your resignation?',
      message: `Your manager and HR will be told. Your last working day would be ${longDate(form.lastDay)}. Once it is approved, only HR can change it.`,
      confirmLabel: 'Send resignation',
    });
    if (!sure) return;
    setBusy(true);
    setNote(null);
    try {
      await guard(resign({ lastDay: form.lastDay, reason: form.reason.trim() || null }));
      setOpen(false);
      setNote({ ok: true, text: 'Sent to your manager and HR. Where it stands shows under My job.' });
      load();
      onSent?.();
    } catch (err) {
      const text = errText(err, 'send it');
      if (text) setNote({ ok: false, text });
    } finally {
      setBusy(false);
    }
  };

  const decided = leaving.status === 'ON_NOTICE' || leaving.status === 'LEFT';
  /* Picks round 52: someone on notice after resigning may ask to stay; their manager decides. */
  const canStay = leaving.status === 'ON_NOTICE' && (leaving.leavingType || 'RESIGNED') === 'RESIGNED' && leaving.lastDay && leaving.lastDay >= t;
  const stay = async () => {
    const sure = await confirmDialog({ title: 'Ask to stay?', message: 'Your manager decides. If they agree, your resignation is taken back and you keep working here.', confirmLabel: 'Ask to stay' });
    if (!sure) return;
    setBusy(true);
    setNote(null);
    try {
      await guard(askToStay({ reason: null }));
      setNote({ ok: true, text: 'Sent to your manager.' });
      load();
    } catch (err) {
      const text = errText(err, 'send it');
      if (text) setNote({ ok: false, text });
    } finally {
      setBusy(false);
    }
  };
  const stayWords = leaving.staying?.status === 'WAITING' || leaving.staying?.status === 'MORE_INFO'
    ? 'You asked to stay. Your manager will answer.'
    : leaving.staying?.status === 'REJECTED' ? 'You asked to stay; your manager kept your last day.' : null;
  return (
    <section className="ui-card space-y-3 p-5" aria-labelledby="leaving-h">
      <h2 id="leaving-h" className="ui-t-sec">Leaving the company</h2>
      {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'}>{note.text}</p> : null}
      {leaving.waiting ? (
        <p className="text-sm">Your resignation is with your manager and HR, sent {longDate(new Date(new Date(leaving.waiting.createdAt).getTime() + 330 * 60_000).toISOString())}.</p>
      ) : decided ? (
        <>
          <p className="text-sm">{leaving.lastDay ? `Your last working day is ${longDate(leaving.lastDay)}.` : 'Your leaving is on record.'} Ask HR to change it.</p>
          {stayWords ? <p className="text-sm" role="status">{stayWords}</p> : null}
          {canStay && !stayWords ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={stay}>Changed your mind? Ask to stay</button> : null}
        </>
      ) : open ? (
        <form onSubmit={send} className="space-y-3">
          <label className="block">
            <span className="ui-label">Last working day *</span>
            <input type="date" className="ui-input w-full" required min={t} value={form.lastDay} onChange={(e) => setForm({ ...form, lastDay: e.target.value })} />
            <span className="ui-caption block">
              {noticeDays ? `Your notice is ${noticeDays} days, so by your terms the last day is ${longDate(earliest)} or later. An earlier day is for your manager and HR to agree.` : 'Your terms do not set a notice period. Check with HR if unsure.'}
            </span>
          </label>
          <label className="block">
            <span className="ui-label">Reason</span>
            <textarea className="ui-input w-full" rows={3} maxLength={1000} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            {/* Company choices, SPEC 3.5: the manager decides the last day; the reason is HR's unless HR shares it. */}
            <span className="ui-caption block">Optional. Seen by HR.</span>
          </label>
          <div className="flex gap-2">
            <button type="submit" className="ui-btn ui-btn-danger flex-1" disabled={busy || !form.lastDay}>{busy ? 'Sending…' : 'Resign'}</button>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <p className="ui-caption">Resign from here. Your manager and HR decide, and the answer shows under My job.</p>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={start}>I want to resign</button>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// My joining or leaving steps
// ---------------------------------------------------------------------------

/**
 * The steps that are mine when I join or leave (Joining & Leaving): the ones
 * I tick myself, and the company things I hand back before my last day,
 * which IT or HR tick when they have them. Nothing shows when there is none.
 */
export function MySteps({ guard, refreshKey }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');
  const [noteFor, setNoteFor] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [said, setSaid] = useState(null);
  const load = useCallback(() => {
    guard(getJourney()).then((d) => { setData(d); setFailed(''); }).catch((e) => setFailed(errText(e, 'load your steps')));
  }, [guard]);
  useEffect(() => { load(); }, [load, refreshKey]);
  if (failed) return <LoadFailed message={failed} onRetry={load} />;
  if (!data) return null;
  const mine = [...data.joining, ...data.leaving.filter((t) => t.mine)];
  if (!mine.length && !data.handBack.length) return null;
  const tick = async (t) => {
    if (t.needsNote && noteFor !== t.id) { setNoteFor(t.id); setNote(''); return; }
    if (t.needsNote && !note.trim()) { setSaid({ ok: false, text: 'Add a note to close this.' }); return; }
    setBusy(t.id);
    setSaid(null);
    try {
      await guard(doneJourneyTask(t.id, note.trim() || null));
      setNoteFor(null);
      setSaid({ ok: true, text: `${t.title}: done.` });
      load();
    } catch (e) {
      const text = errText(e, 'save the changes');
      if (text) setSaid({ ok: false, text });
    } finally {
      setBusy('');
    }
  };
  const row = (t, own) => (
    <li key={t.id} className="flex items-start gap-3 py-2">
      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${t.done ? 'ui-muted line-through' : ''}`}>{t.title}</span>
        <span className="block ui-caption">{t.done ? 'Done' : t.dueDate ? `By ${longDate(t.dueDate)}` : ''}{!own && !t.done ? ' · HR or IT marks it when they have it' : ''}</span>
        {noteFor === t.id ? <textarea className="ui-input mt-2 w-full" rows={2} maxLength={500} aria-label={`Note for ${t.title}`} value={note} onChange={(e) => setNote(e.target.value)} /> : null}
      </span>
      {own && !t.done ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy === t.id} onClick={() => tick(t)}>{busy === t.id ? 'Saving…' : noteFor === t.id ? 'Save' : 'Done'}</button> : null}
    </li>
  );
  return (
    <section className="ui-card space-y-2 p-5" aria-labelledby="steps-h">
      <h2 id="steps-h" className="ui-t-sec">{data.leaving.length ? 'Before your last day' : 'Your joining steps'}</h2>
      {said ? <p className="text-sm" role={said.ok ? 'status' : 'alert'}>{said.text}</p> : null}
      {mine.length ? <ul className="divide-y" aria-label="Your steps">{mine.map((t) => row(t, true))}</ul> : null}
      {data.handBack.length ? (
        <>
          <h3 className="ui-label pt-2">Hand back</h3>
          <ul className="divide-y" aria-label="Hand back">{data.handBack.map((t) => row(t, false))}</ul>
        </>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Private complaint
// ---------------------------------------------------------------------------

const COMPLAINT_KINDS = [
  ['POSH', 'Sexual harassment', 'Goes to the Internal Committee.'],
  ['GRIEVANCE', 'Another complaint about work', 'Goes to the grievance committee.'],
];

/**
 * A quiet link, then a short form (PRIV-02). It goes to the committee the
 * company named, not through a manager. Afterwards only the reference and the
 * date the inquiry is due are shown; the complaint is never listed back here,
 * so a phone left on a desk does not show it.
 */
export function PrivateComplaint({ guard }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind: 'POSH', incidentOn: '', summary: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await guard(raisePrivateCase(form));
      setDone({ reference: r.reference, inquiryDue: r.inquiryDue });
      setForm({ kind: 'POSH', incidentOn: '', summary: '' });
      setOpen(false);
    } catch (err) {
      setError(errText(err, 'send it'));
    } finally {
      setBusy(false);
    }
  };
  if (done) {
    return (
      <section className="ui-card space-y-2 p-5" aria-labelledby="pc-done-h" role="status">
        <h2 id="pc-done-h" className="ui-t-sec">Complaint received</h2>
        <p className="text-sm">Your reference is <span className="ui-mono font-medium">{done.reference}</span>.{done.inquiryDue ? ` The committee should finish its inquiry by ${longDate(done.inquiryDue)}.` : ''}</p>
        <p className="ui-caption">Note the reference down. It is not listed in the app. The committee will contact you.</p>
        <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setDone(null)}>Close</button>
      </section>
    );
  }
  if (!open) return <button type="button" className="ui-link px-1 text-sm" onClick={() => setOpen(true)}>Raise a private complaint</button>;
  return (
    <form onSubmit={send} className="ui-card space-y-3 p-5" aria-labelledby="pc-h">
      <h2 id="pc-h" className="ui-t-sec">Private complaint</h2>
      <p className="ui-caption">It goes to the committee your company named for this, not through your manager. You get a reference; nothing about it is shown in the app afterwards.</p>
      <fieldset className="space-y-2 text-sm">
        <legend className="ui-label">What it is about</legend>
        {COMPLAINT_KINDS.map(([k, label, hint]) => (
          <label key={k} className="flex items-start gap-2">
            <input type="radio" name="pc-kind" className="mt-1" checked={form.kind === k} onChange={() => setForm({ ...form, kind: k })} />
            <span><span className="font-medium">{label}</span><span className="ui-caption block">{hint}</span></span>
          </label>
        ))}
      </fieldset>
      <label className="block">
        <span className="ui-label">When it happened *</span>
        <input type="date" className="ui-input w-full" required max={todayIst()} value={form.incidentOn} onChange={(e) => setForm({ ...form, incidentOn: e.target.value })} />
      </label>
      <label className="block">
        <span className="ui-label">What happened *</span>
        <textarea className="ui-input w-full" rows={5} required minLength={10} maxLength={20000} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
      </label>
      {error ? <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" className="ui-btn ui-btn-primary flex-1" disabled={busy}>{busy ? 'Sending…' : 'Send to the committee'}</button>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={() => { setOpen(false); setError(''); }}>Cancel</button>
      </div>
    </form>
  );
}
