import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ShieldCheck } from '@ui/components/ui/lineIcons';

import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import Popover from '@ui/components/ui/Popover';
import { EXPORT_FORMATS, runListExport } from '@ui/components/list/exportMenu';
import { getDataHealth, getHeadcount, markFullDaysPaid, snoozeHealthCheck, unmarkFullDaysPaid, unsnoozeHealthCheck } from './api';
import { notify } from '@ui/components/ui/notify';
import { plusDaysIso } from '@ui/utils/dates';
import './data-health.css';

/**
 * Data health (HR research, Phase 1: the implementation auditor). What is
 * wrong in the employee, leave, reader and payroll data before it costs a
 * payroll: duplicates, missing joining dates, PAN / UAN / ESIC / bank details
 * the statutory and bank files need. Each check says why it matters, who,
 * and opens the screen that fixes it. Read-only: nothing is changed here.
 */
const SEVERITY = {
  BLOCKS_PAYROLL: { label: 'Blocks payday', tone: 'neg' },
  FIX_SOON: { label: 'Fix soon', tone: 'warn' },
  TIDY_UP: { label: 'Tidy up', tone: 'neutral' },
};
/* Which app owns each fix screen; a screen of the app on show opens in place. */
const APP_OF = { Payroll: 'payroll', People: 'people' };
const APP_NAME = { payroll: 'Payroll', people: 'People', attendance: 'Attendance' };

/** A snooze suggests two weeks; the person can change it. */
const twoWeeksOn = () => plusDaysIso(14);
const sixMonthsOn = () => plusDaysIso(182);
const tomorrow = () => plusDaysIso(1);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthWords = (ym) => { const [y, m] = String(ym).split('-'); return y && m ? `${MONTHS[Number(m) - 1]} ${y}` : ym; };

const EXPORT_COLUMNS = [
  { key: 'severity', label: 'Severity', value: (r) => SEVERITY[r.severity]?.label || r.severity },
  { key: 'title', label: 'Check' },
  { key: 'name', label: 'Person' },
  { key: 'code', label: 'Employee ID' },
  { key: 'detail', label: 'Detail' },
  { key: 'fix', label: 'How to fix' },
];

export default function DataHealth({ openScreen, app = 'attendance', localScreens = [] }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    getDataHealth()
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(String(e?.message || 'Could not check the data.')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const fixLink = (c) => {
    const owner = APP_OF[c.area] || 'attendance';
    if (owner === app && openScreen && (localScreens.length === 0 || localScreens.includes(c.screen))) {
      return <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => openScreen(c.screen)}>Fix</button>;
    }
    return <a className="ui-btn ui-btn-secondary ui-btn-sm" href={`?app=${owner}&open=${encodeURIComponent(c.screen)}`}>Fix in {APP_NAME[owner] || owner}</a>;
  };
  /* Snooze (HLTH-03): a reason and the date it comes back; logged. */
  const [snoozing, setSnoozing] = useState(null);
  const wake = async (c) => {
    try {
      await unsnoozeHealthCheck(c.id);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not changed.'));
    }
  };
  /* Full days paid short (fullDayFix.ts): marked paid after a confirmation with an optional note; the last one can be undone. */
  const [paying, setPaying] = useState(null);
  const [lastPaid, setLastPaid] = useState(null);
  const undoPaid = async () => {
    const was = lastPaid;
    try {
      await unmarkFullDaysPaid(was.ids);
      setLastPaid(null);
      notify.success(`${was.name}'s days are held again.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not undone.'));
    }
  };
  const rows = (data?.checks || []).flatMap((c) => c.people.map((p) => ({ severity: c.severity, title: c.title, name: p.name, code: p.code || '', detail: p.detail || '', fix: c.fix })));
  const download = (format) => runListExport({ format, title: 'Data check', fileName: 'Data check', label: 'problem/problems', columns: EXPORT_COLUMNS, rows });
  const score = data ? healthScore(data) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data check"
        description="Gaps in employee records that will cause problems in Payroll, compliance or approvals."
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" className="ui-btn ui-btn-secondary" onClick={load}>Check again</button>
            <DownloadButton onPick={download} disabled={!rows.length} />
          </span>
        }
      />
      <div className="dh-page">
        {error ? <p className="ui-field-error" role="alert">{error}</p> : null}
        {!data ? (
          error ? null : <SkeletonCard lines={8} />
        ) : (
          <>
            {/* Two tiles (PEOPLE-26): the score with its bar, and what stops the next payday. */}
            <dl className="dh-tiles" aria-label="Summary">
              <div className="dh-tile">
                <dt className="dh-tile-label">Health score</dt>
                <dd className="dh-tile-figure"><span className="dh-tile-value">{score.value}</span><span className="dh-tile-of">/ 100</span></dd>
                <dd className="dh-bar" role="progressbar" aria-label="Health score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score.value}><span style={{ width: `${score.value}%` }} /></dd>
                <dd className="dh-tile-note">{score.note}</dd>
              </div>
              <div className="dh-tile">
                <dt className="dh-tile-label">Blocks payday</dt>
                <dd className="dh-tile-figure"><span className="dh-tile-value" data-tone={data.blocking ? 'neg' : undefined}>{data.blocking}</span></dd>
                <dd className="dh-tile-note">{data.blocking ? 'Problems payroll cannot run past. Fix these first.' : 'Nothing stands in the way of the next payroll.'}</dd>
              </div>
            </dl>
            {lastPaid ? (
              <p className="flex flex-wrap items-center gap-2 text-sm" role="status">
                <span>{lastPaid.count} day{lastPaid.count === 1 ? '' : 's'} for {lastPaid.name} marked paid.</span>
                <button type="button" className="ui-link" onClick={undoPaid}>Undo</button>
              </p>
            ) : null}
            {!data.checks.length ? (
              <EmptyState icon={ShieldCheck} title="Nothing to fix" description="Every check passed: no duplicates, joining dates in place, and payroll has the PAN, UAN, ESIC and bank details it needs." />
            ) : (
              /* One ruled row per check: severity, what and why, how many, and the way to fix it; who sits under it. */
              <section className="dh-section" aria-label="Checks">
                <div className="dh-section-head">
                  <h2 className="dh-section-title">Checks <span className="ui-caption tabular-nums">{data.checks.length}</span></h2>
                </div>
                <ul className="dh-list">
                  {data.checks.map((c) => {
                    const sev = SEVERITY[c.severity] || { label: c.severity, tone: 'neutral' };
                    return (
                      <li key={c.id} className="dh-row">
                        <section aria-label={c.title}>
                          <div className="dh-row-main">
                            <div className="dh-row-what">
                              <span className="dh-dot" data-tone={sev.tone} aria-hidden="true" />
                              <div className="dh-row-text">
                                <h3 className="dh-row-title">{c.title}</h3>
                                <p className="dh-row-why">{c.why} {c.fix}</p>
                              </div>
                            </div>
                            <div className="dh-row-side">
                              <span className="dh-row-area">{c.area}</span>
                              <span className="ui-pill ui-pill-neutral">{sev.label}</span>
                              <span className="dh-count">{c.count} {c.count === 1 ? 'person' : 'people'}</span>
                              <button type="button" className="ui-link text-sm" onClick={() => setSnoozing(c)}>Snooze</button>
                              {fixLink(c)}
                            </div>
                          </div>
                          <ul className="dh-who" aria-label="Who">
                            {c.people.map((p, i) => (
                              <li key={`${p.id}-${i}`}>
                                {/* A long detail (several days) wraps inside its pill rather than pushing the page wide on a phone. */}
                                <span className="ui-pill ui-pill-neutral">
                                  {p.name}
                                  {p.code ? ` · ${p.code}` : ''}
                                  {p.detail ? ` — ${p.detail}` : ''}
                                </span>
                                {p.settle?.length ? (
                                  <button type="button" className="ui-link text-sm" onClick={() => setPaying(p)} aria-label={`Paid the difference to ${p.name}`}>
                                    Paid the difference
                                  </button>
                                ) : null}
                              </li>
                            ))}
                            {c.count > c.people.length ? <li className="ui-caption">and {c.count - c.people.length} more</li> : null}
                          </ul>
                        </section>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            {data.snoozed?.length ? (
              <section aria-label="Snoozed" className="dh-section">
                <h2 className="dh-section-title">Snoozed</h2>
                <ul className="dh-plain">
                  {data.snoozed.map((c) => (
                    <li key={c.id}>
                      <span className="font-medium">{c.title}</span>
                      <span className="ui-caption">· <span className="tabular-nums">{c.count}</span> · back <span className="tabular-nums">{formatDate(c.snooze.until)}</span> · {c.snooze.reason}</span>
                      <button type="button" className="ui-link ml-auto" onClick={() => wake(c)}>Bring back now</button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {app === 'people' ? <Headcount /> : null}
          </>
        )}
      </div>
      {paying ? <PaidDrawer person={paying} onClose={() => setPaying(null)} onDone={(count) => { setLastPaid({ name: paying.name, ids: paying.settle, count }); setPaying(null); load(); }} /> : null}
      {snoozing ? <SnoozeDrawer check={snoozing} onClose={() => setSnoozing(null)} onDone={() => { setSnoozing(null); load(); }} /> : null}
    </div>
  );
}

/**
 * The score on the first tile: the share of the people checked with no gap that blocks payday or needs fixing soon
 * (tidy-ups are listed but do not lower it). Each check lists a sample of its people, so the people with such a gap
 * are at least the distinct names shown and at least the largest single check; "at least" says when it is a floor.
 */
function healthScore({ people = 0, checks = [] }) {
  const issues = checks.reduce((n, c) => n + (c.count || 0), 0);
  const serious = checks.filter((c) => c.severity !== 'TIDY_UP');
  const ids = new Set();
  let partial = false;
  for (const c of serious) {
    for (const p of c.people || []) if (p.id) ids.add(p.id);
    if ((c.count || 0) > (c.people || []).filter((p) => p.id).length) partial = true;
  }
  const largest = serious.reduce((n, c) => Math.max(n, c.count || 0), 0);
  const affected = Math.min(people, Math.max(ids.size, largest));
  const value = people > 0 ? Math.round(((people - affected) / people) * 100) : 100;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  let note = `No gaps across ${plural(people, 'person', 'people')} checked`;
  if (issues) {
    const head = `${plural(issues, 'issue', 'issues')} in ${plural(checks.length, 'check', 'checks')}`;
    note = affected
      ? `${head} · ${partial && affected < people ? 'at least ' : ''}${affected} of ${plural(people, 'person', 'people')} need${affected === 1 ? 's' : ''} a fix`
      : `${head}, all tidy-ups`;
  }
  return { value, note };
}

/** "Download list": the checks and their people as PDF, Excel or CSV. */
function DownloadButton({ onPick, disabled }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" ref={ref} className="ui-btn ui-btn-secondary" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((v) => !v)}>
        Download list <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open ? (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} minWidth={180}>
          <div className="py-1" role="menu" aria-label="Download list as">
            {EXPORT_FORMATS.map((f) => (
              <button key={f.key} type="button" role="menuitem" className="ui-menu-item flex w-full items-center gap-2" onClick={() => { setOpen(false); onPick(f.key); }}>
                <f.Icon size={16} aria-hidden="true" /> {f.label}
              </button>
            ))}
          </div>
        </Popover>
      ) : null}
    </>
  );
}

/** "Paid the difference" for one person's held days: says which, takes an optional note (kept with the days and in the audit log). */
function PaidDrawer({ person, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true);
    try {
      const r = await markFullDaysPaid(person.settle, note.trim() || null);
      onDone(r?.settled ?? person.settle.length);
    } catch (e) {
      setError(String(e?.message || 'Not changed.'));
    } finally {
      setBusy(false);
    }
  };
  const n = person.settle.length;
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(32rem,96vw)] ui-drawer-sheet" title={`Paid the difference to ${person.name}?`} dirty={Boolean(note)}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : `Mark ${n} day${n === 1 ? '' : 's'} paid`}</button></>}>
      <div className="grid gap-4">
        <p className="text-sm">{person.detail}</p>
        <p className="ui-caption">Only once the difference has gone out, as a Payroll adjustment or otherwise. The days leave this list; you can undo it straight after.</p>
        <label className="block"><span className="ui-label">Note</span><textarea className="ui-input w-full" rows={2} maxLength={300} value={note} placeholder="How it was paid (optional)" onChange={(e) => { setNote(e.target.value); setError(''); }} /></label>
        {error ? <p className="ui-field-error" role="alert">{error}</p> : null}
      </div>
    </Drawer>
  );
}

/** Snooze one check: why it can wait and the day it comes back (within six months); logged on the server. */
function SnoozeDrawer({ check, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState(twoWeeksOn());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!reason.trim()) { setError('Say why it can wait.'); return; }
    setBusy(true);
    try {
      await snoozeHealthCheck(check.id, { reason: reason.trim(), until });
      notify.success(`Snoozed until ${formatDate(until)}.`);
      onDone();
    } catch (e) {
      setError(String(e?.message || 'Not snoozed.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(32rem,96vw)] ui-drawer-sheet" title={`Snooze: ${check.title}`} dirty={Boolean(reason)}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy || !until} onClick={save}>{busy ? 'Saving…' : 'Snooze'}</button></>}>
      <div className="grid gap-4">
        <label className="block"><span className="ui-label">Why it can wait *</span><textarea className="ui-input w-full" rows={2} maxLength={300} value={reason} aria-invalid={error ? true : undefined} onChange={(e) => { setReason(e.target.value); setError(''); }} /></label>
        {error ? <p className="ui-field-error" role="alert">{error}</p> : null}
        <div><label className="ui-label" htmlFor="snooze-until">Comes back on</label><DatePicker id="snooze-until" value={until} min={tomorrow()} max={sixMonthsOn()} onChange={(v) => setUntil(v || '')} /></div>
      </div>
    </Drawer>
  );
}

/** Headcount and movements (HLTH-04): as of a day, by establishment; joiners, leavers and transfers month by month. */
function Headcount() {
  const [today] = useState(() => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
  const [asOf, setAsOf] = useState(today);
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    getHeadcount({ asOf, to: today }).then((d) => live && setData(d)).catch(() => live && setData(null));
    return () => { live = false; };
  }, [asOf, today]);
  if (!data) return null;
  /* Attrition the usual way: leavers over the months shown, divided by the average headcount at month end. */
  const avg = data.months.length ? data.months.reduce((a, m) => a + m.headcountAtEnd, 0) / data.months.length : 0;
  const leavers = data.months.reduce((a, m) => a + m.leavers, 0);
  const attrition = avg > 0 ? Math.round((leavers / avg) * 1000) / 10 : null;
  return (
    <section aria-label="Headcount" className="dh-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="dh-section-title">Headcount and movements</h2>
        <div className="flex items-center gap-2 text-sm"><label htmlFor="headcount-asof">As of</label><DatePicker id="headcount-asof" value={asOf} max={today} onChange={(v) => setAsOf(v || today)} /></div>
      </div>
      <p className="text-sm"><span className="tabular-nums font-medium">{data.headcount}</span> {data.headcount === 1 ? 'person' : 'people'} on {formatDate(data.asOf)}{Object.keys(data.byEstablishment).length ? ': ' : ''}{Object.entries(data.byEstablishment).map(([k, v]) => `${k} ${v}`).join(', ')}</p>
      {attrition !== null ? <p className="text-sm">Left in the last {data.months.length} months: <span className="tabular-nums font-medium">{attrition}%</span> of the average headcount</p> : null}
      <div className="dh-table-wrap">
      <table className="dh-table">
        <thead><tr><th>Month</th><th className="num">Joined</th><th className="num">Left</th><th className="num">Transferred</th><th className="num">At month end</th></tr></thead>
        <tbody>
          {[...data.months].reverse().map((m) => (
            <tr key={m.month}>
              <td>{monthWords(m.month)}</td>
              <td className="num">{m.joiners}</td>
              <td className="num">{m.leavers}</td>
              <td className="num">{m.transfers}</td>
              <td className="num">{m.headcountAtEnd}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}
