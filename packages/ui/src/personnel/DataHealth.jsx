import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from '@ui/components/ui/lineIcons';

import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { MoreButton } from '@ui/components/list/ListPageParts';
import { getDataHealth, getHeadcount, snoozeHealthCheck, unsnoozeHealthCheck } from './api';
import { notify } from '@ui/components/ui/notify';
import { plusDaysIso } from '@ui/utils/dates';

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
  const rows = (data?.checks || []).flatMap((c) => c.people.map((p) => ({ severity: c.severity, title: c.title, name: p.name, code: p.code || '', detail: p.detail || '', fix: c.fix })));

  return (
    <div className="space-y-6">
      <PageHeader
        entity="privacy"
        title="Data check"
        actions={
          <span className="flex items-center gap-2">
            <button type="button" className="ui-btn ui-btn-secondary" onClick={load}>Check again</button>
            <MoreButton
              items={[exportMenuItem('Export')]}
              onSelect={(k) => {
                const format = exportFormatFromKey(k);
                if (format) runListExport({ format, title: 'Data check', fileName: 'Data check', label: 'problem/problems', columns: EXPORT_COLUMNS, rows });
              }}
            />
          </span>
        }
      />
      <div className="pb-8 space-y-6">
        {error ? <p className="ui-field-error" role="alert">{error}</p> : null}
        {!data ? (
          error ? null : <SkeletonCard lines={8} />
        ) : (
          <>
            <dl className="ui-metric-strip" aria-label="Summary">
              <div className="ui-metric"><span><dd className="ui-metric-value tabular-nums">{data.people}</dd><dt className="ui-metric-label">People checked</dt></span></div>
              <div className="ui-metric"><span><dd className={`ui-metric-value tabular-nums${data.blocking ? ' ui-text-neg' : ''}`}>{data.blocking}</dd><dt className="ui-metric-label">Blocks payday</dt></span></div>
              <div className="ui-metric"><span><dd className="ui-metric-value tabular-nums">{data.checks.length}</dd><dt className="ui-metric-label">Checks to look at</dt></span></div>
            </dl>
            {!data.checks.length ? (
              <EmptyState icon={ShieldCheck} title="Nothing to fix" description="Every check passed: no duplicates, joining dates in place, and payroll has the PAN, UAN, ESIC and bank details it needs." />
            ) : (
              /* One check per ruled block on the page: what, why, who, and the way to fix it. */
              <div className="ui-health-list">
                {data.checks.map((c) => (
                  <section key={c.id} className="ui-health-item" aria-label={c.title}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`ui-pill ui-pill-${SEVERITY[c.severity]?.tone || 'neutral'}`}>{SEVERITY[c.severity]?.label || c.severity}</span>
                          <span className="ui-caption">{c.area}</span>
                        </div>
                        <h2 className="ui-t-sec">{c.title} <span className="ui-caption tabular-nums">{c.count}</span></h2>
                      </div>
                      <span className="flex items-center gap-3">
                        <button type="button" className="ui-link text-sm" onClick={() => setSnoozing(c)}>Snooze</button>
                        {fixLink(c)}
                      </span>
                    </div>
                    <p className="text-sm">{c.why} {c.fix}</p>
                    <ul className="flex flex-wrap gap-2" aria-label="Who">
                      {c.people.map((p, i) => (
                        <li key={`${p.id}-${i}`} className="ui-pill ui-pill-neutral">
                          {p.name}
                          {p.code ? ` · ${p.code}` : ''}
                          {p.detail ? ` — ${p.detail}` : ''}
                        </li>
                      ))}
                      {c.count > c.people.length ? <li className="ui-caption self-center">and {c.count - c.people.length} more</li> : null}
                    </ul>
                  </section>
                ))}
              </div>
            )}
            {data.snoozed?.length ? (
              <section aria-label="Snoozed" className="space-y-2">
                <h2 className="ui-t-sec">Snoozed</h2>
                <ul className="divide-y text-sm">
                  {data.snoozed.map((c) => (
                    <li key={c.id} className="py-2 flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.title}</span>
                      <span className="ui-caption">· {c.count} · back <span className="tabular-nums">{formatDate(c.snooze.until)}</span> · {c.snooze.reason}</span>
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
      {snoozing ? <SnoozeDrawer check={snoozing} onClose={() => setSnoozing(null)} onDone={() => { setSnoozing(null); load(); }} /> : null}
    </div>
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
    <section aria-label="Headcount" className="space-y-3 border-t pt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="ui-t-sec">Headcount and movements</h2>
        <div className="flex items-center gap-2 text-sm"><label htmlFor="headcount-asof">As of</label><DatePicker id="headcount-asof" value={asOf} max={today} onChange={(v) => setAsOf(v || today)} /></div>
      </div>
      <p className="text-sm"><span className="tabular-nums font-medium">{data.headcount}</span> {data.headcount === 1 ? 'person' : 'people'} on {formatDate(data.asOf)}{Object.keys(data.byEstablishment).length ? ': ' : ''}{Object.entries(data.byEstablishment).map(([k, v]) => `${k} ${v}`).join(', ')}</p>
      {attrition !== null ? <p className="text-sm">Left in the last {data.months.length} months: <span className="tabular-nums font-medium">{attrition}%</span> of the average headcount</p> : null}
      <table className="w-full text-sm">
        <thead><tr className="ui-caption text-left"><th className="py-1.5 font-medium">Month</th><th className="py-1.5 font-medium text-right">Joined</th><th className="py-1.5 font-medium text-right">Left</th><th className="py-1.5 font-medium text-right">Transferred</th><th className="py-1.5 font-medium text-right">At month end</th></tr></thead>
        <tbody className="divide-y">
          {[...data.months].reverse().map((m) => (
            <tr key={m.month}>
              <td className="py-1.5">{monthWords(m.month)}</td>
              <td className="py-1.5 text-right tabular-nums">{m.joiners}</td>
              <td className="py-1.5 text-right tabular-nums">{m.leavers}</td>
              <td className="py-1.5 text-right tabular-nums">{m.transfers}</td>
              <td className="py-1.5 text-right tabular-nums">{m.headcountAtEnd}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
