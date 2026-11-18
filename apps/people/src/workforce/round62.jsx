import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Mail, Phone } from 'lucide-react';
import CopyWord from '@ui/components/ui/CopyWord';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { formatDate } from '@ui/components/ui/DatePicker';
import { getLeaveBalances, listLeaveRequests, listRecords, swatchOf } from '@ui/timeOff/api';
import { todayIst } from '@ui/utils/dates';
import { wholeRupees as rupees } from '@ui/utils/money';
import { formatPhone } from '@ui/utils/phone';
import { phoneLinks } from '@ui/components/ui/CallButtons';
import { leaveToday, monthLine, neighbours, readRecordList } from '@ui/picks/round62';
import { listAssignments } from '../../../payroll/src/api/payrollPeople';

/*
 * Round 62 picks, an employee's record (owner's picker, chosen 18 Nov 2026). Each part below names its pick.
 */

const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const day = (iso) => formatDate(String(iso).slice(0, 10));

/* contactactions A: the phone and e-mail in the record's header open the call or the mail, each with Copy. */
export function PhoneFact({ phone, name }) {
  const links = phoneLinks(phone);
  if (!phone) return <span className="ui-muted">Not given</span>;
  return (
    <span className="r62-contact">
      {links ? <a className="ui-link tabular-nums" href={links.tel} aria-label={`Call ${name}`}><Phone size={14} aria-hidden="true" /> {formatPhone(phone)}</a> : <span className="tabular-nums">{phone}</span>}
      <CopyWord value={phone} what="phone number" />
    </span>
  );
}

export function EmailLink({ email, name }) {
  if (!email) return null;
  return (
    <span className="r62-contact">
      <a className="ui-link" href={`mailto:${email}`} aria-label={`E-mail ${name}`}><Mail size={14} aria-hidden="true" /> {email}</a>
      <CopyWord value={email} what="e-mail" />
    </span>
  );
}

/* statusbadge A: "On leave today" beside the status, with the day they are back. */
export function OnLeaveToday({ employeeId, canRead }) {
  const today = todayIst();
  const req = useRequest(() => (canRead ? listLeaveRequests({ employeeId, status: 'APPROVED', from: today, to: today }) : Promise.resolve([])), [employeeId, canRead]);
  const away = leaveToday(req.data, today);
  if (!away) return null;
  return <span className="ui-pill ui-pill-info r62-away">On leave today <span className="r62-away-note">{away.type} · back after {day(away.until)}</span></span>;
}

/* nextprevrecord A: ‹ › through the list the person was opened from, with where they sit in it. */
export function RecordStepper({ id, openScreen }) {
  /* Read again for each person: the list may have changed in another visit to Employees. */
  const ids = useMemo(() => readRecordList(), [id]);
  const at = neighbours(id, ids);
  if (!at) return null;
  const go = (to) => openScreen?.('employee', { id: to });
  return (
    <nav className="r62-stepper" aria-label="Move through the list">
      <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm ui-icon-btn" disabled={!at.prev} onClick={() => go(at.prev)} aria-label="Previous person"><ChevronLeft size={16} aria-hidden="true" /></button>
      <span className="ui-caption tabular-nums">{at.index + 1} of {at.total}</span>
      <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm ui-icon-btn" disabled={!at.next} onClick={() => go(at.next)} aria-label="Next person"><ChevronRight size={16} aria-hidden="true" /></button>
    </nav>
  );
}

/* leftrecord A: a grey band for someone who has left, with the follow-up one click away. */
export function LeftBand({ person, leavingWord, payrollOn, openScreen }) {
  if (person.status !== 'LEFT') return null;
  return (
    <section className="r62-left-band" aria-label="Has left">
      <p><b>Left{person.dateOfLeaving ? ` on ${day(person.dateOfLeaving)}` : ''}</b>{leavingWord ? ` · ${leavingWord}` : ''}{person.leavingReason ? ` · ${person.leavingReason}` : ''}</p>
      <p className="r62-left-links">
        {payrollOn ? <a className="ui-link" href="?app=payroll&open=settlements">Final settlement</a> : null}
        <button type="button" className="ui-link" onClick={() => openScreen?.('leavers')}>Leaving list</button>
      </p>
    </section>
  );
}

/* timetab A: leave left, leave coming up and this month so far, the questions HR is asked most. */
export function TimeTab({ person, canLeave, canRecords, openScreen }) {
  const today = todayIst();
  const monthStart = `${today.slice(0, 7)}-01`;
  const balances = useRequest(() => (canLeave ? getLeaveBalances() : Promise.resolve(null)), [canLeave]);
  const upcoming = useRequest(() => (canLeave ? listLeaveRequests({ employeeId: person.id, from: today, to: addDays(today, 90) }) : Promise.resolve([])), [person.id, canLeave]);
  const month = useRequest(() => (canRecords ? listRecords({ employeeId: person.id, from: monthStart, to: today }) : Promise.resolve([])), [person.id, canRecords]);
  const row = balances.data?.rows?.find((r) => r.employeeId === person.id);
  const types = (balances.data?.types || []).filter((t) => row?.balances?.[t.id]);
  const coming = (upcoming.data || []).filter((r) => r.status === 'APPROVED' || r.status === 'PENDING').sort((a, b) => String(a.fromDate).localeCompare(String(b.fromDate)));
  const line = monthLine(month.data);
  const monthName = new Date(`${monthStart}T00:00:00Z`).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' });
  return (
    <div className="r62-time space-y-6">
      {canRecords ? (
        <section className="ui-record-section" aria-label="This month">
          <h2 className="pc-section-title">{monthName} so far</h2>
          {month.loading ? <span className="ui-skel ui-skel-text" /> : month.error ? <ErrorState error={month.error} onRetry={month.reload} compact /> : (
            <p className="r62-month-line tabular-nums">{(month.data || []).length ? line.text : 'No days marked yet this month.'}</p>
          )}
          <button type="button" className="ui-link text-sm" onClick={() => openScreen?.('records', { employeeId: person.id, from: monthStart, to: today })}>Open attendance</button>
        </section>
      ) : null}
      {canLeave ? (
        <section className="ui-record-section" aria-label="Leave balance">
          <h2 className="pc-section-title">Leave balance</h2>
          {balances.loading ? <span className="ui-skel ui-skel-text" /> : balances.error ? <ErrorState error={balances.error} onRetry={balances.reload} compact /> : types.length ? (
            <ul className="r62-balances">
              {types.map((t) => {
                const n = Number(row.balances[t.id].available ?? 0);
                return (
                  <li key={t.id}>
                    <span className="pc-leave-pill" style={{ '--swatch': swatchOf(t) }}><i aria-hidden="true" /><span>{t.name}</span></span>
                    <b className={`tabular-nums ${n < 0 ? 'ui-text-neg' : ''}`}>{row.balances[t.id].available ?? '—'} {Math.abs(n) === 1 ? 'day' : 'days'}</b>
                  </li>
                );
              })}
            </ul>
          ) : <p className="ui-muted">No leave types give {person.preferredName || person.firstName || 'them'} days yet.</p>}
        </section>
      ) : null}
      {canLeave ? (
        <section className="ui-record-section" aria-label="Leave coming up">
          <h2 className="pc-section-title">Leave coming up</h2>
          {upcoming.loading ? <span className="ui-skel ui-skel-text" /> : upcoming.error ? <ErrorState error={upcoming.error} onRetry={upcoming.reload} compact /> : coming.length ? (
            <ul className="r62-upcoming">
              {coming.map((r) => (
                <li key={r.id}>
                  <span className="tabular-nums">{day(r.fromDate)}{String(r.toDate).slice(0, 10) !== String(r.fromDate).slice(0, 10) ? ` – ${day(r.toDate)}` : ''}</span>
                  <span>{r.leaveTypeName || 'Leave'}</span>
                  <span className={`ui-pill ${r.status === 'APPROVED' ? 'ui-pill-pos' : 'ui-pill-warn'}`}>{r.status === 'APPROVED' ? 'Approved' : 'Waiting'}</span>
                </li>
              ))}
            </ul>
          ) : <p className="ui-muted">Nothing in the next 90 days.</p>}
        </section>
      ) : null}
    </div>
  );
}

/* salaryonrecord A: the salary kept hidden until Show, so nobody reads it over a shoulder. */
export function PayTab({ person, canChange }) {
  const req = useRequest(() => listAssignments({ employeeId: person.id, status: 'ACTIVE' }), [person.id]);
  /* The record keys this tab by person, so moving to someone else starts hidden again. */
  const [shown, setShown] = useState(false);
  const a = (req.data || []).sort((x, y) => String(y.effectiveFrom).localeCompare(String(x.effectiveFrom)))[0];
  return (
    <div className="space-y-6">
      <section className="ui-record-section" aria-label="Salary">
        <h2 className="pc-section-title">Salary</h2>
        {req.loading ? <span className="ui-skel ui-skel-text" /> : req.error ? <ErrorState error={req.error} onRetry={req.reload} compact /> : !a ? (
          <p className="ui-muted">No salary recorded yet.{canChange ? <> <a className="ui-link" href={`?app=payroll&open=assignments&s.new=${encodeURIComponent(person.id)}`}>Record a salary</a></> : null}</p>
        ) : (
          <dl className="ui-field-grid">
            <div className="ui-field"><dt>Yearly CTC</dt><dd className="r62-money tabular-nums">{shown ? rupees(a.annualCtc) : '₹ ••••••'}</dd></div>
            <div className="ui-field"><dt>Monthly CTC</dt><dd className="r62-money tabular-nums">{shown ? rupees(a.monthlyCtc) : '₹ ••••'}</dd></div>
            <div className="ui-field"><dt>Since</dt><dd className="tabular-nums">{day(a.effectiveFrom)}</dd></div>
            {a.structure?.name ? <div className="ui-field"><dt>Structure</dt><dd>{a.structure.name}</dd></div> : null}
          </dl>
        )}
        {a ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm mt-3" aria-pressed={shown} onClick={() => setShown((s) => !s)}>{shown ? 'Hide' : 'Show'}</button> : null}
      </section>
      <p className="ui-caption">Payslips, revisions and tax are in Payroll. <a className="ui-link" href="?app=payroll&open=slips">Payslips</a> · <a className="ui-link" href="?app=payroll&open=revisions">Salary revisions</a></p>
    </div>
  );
}

/* profileprint A: a clean printed page, salary left off unless ticked. */
export function PrintProfile({ person, salaryAllowed, onClose, onPrint }) {
  const [salary, setSalary] = useState(false);
  return (
    <Drawer open onClose={onClose} title={`Print ${person.name}'s profile`} widthClass="w-[min(28rem,96vw)]"
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" onClick={() => onPrint({ salary })}>Print</button></>}>
      <p className="ui-muted">The page prints the header and the overview: job, contact and team. Nothing else on screen goes with it.</p>
      {salaryAllowed ? (
        <label className="r62-tick mt-4"><input type="checkbox" checked={salary} onChange={(e) => setSalary(e.target.checked)} /> Include salary</label>
      ) : null}
    </Drawer>
  );
}

/* The printed salary line, drawn only while printing with salary ticked. */
export function PrintSalaryLine({ person }) {
  const req = useRequest(() => listAssignments({ employeeId: person.id, status: 'ACTIVE' }), [person.id]);
  const a = (req.data || [])[0];
  if (!a) return null;
  return <p className="r62-print-salary tabular-nums">Yearly CTC {rupees(a.annualCtc)} · monthly {rupees(a.monthlyCtc)}</p>;
}

/* Turns print mode on for one print, then off again. */
export function printProfile({ salary }, onDone) {
  const root = document.documentElement;
  root.dataset.printProfile = salary ? 'salary' : 'plain';
  const end = () => { delete root.dataset.printProfile; window.removeEventListener('afterprint', end); onDone?.(); };
  window.addEventListener('afterprint', end);
  /* With salary ticked, a moment for its line to arrive before the print dialog opens. */
  setTimeout(() => { try { window.print(); } catch { end(); } }, salary ? 800 : 50);
}
