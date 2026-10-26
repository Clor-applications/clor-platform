import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import { EmptyState, PageHeader, SkeletonCard, StatTile } from '@ui/components/ui/Primitives';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { MoreButton } from '@ui/components/list/ListPageParts';
import { getDataHealth, getHeadcount, snoozeHealthCheck, unsnoozeHealthCheck } from './api';
import { notify } from '@ui/components/ui/notify';

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
const twoWeeksOn = () => new Date(Date.now() + 330 * 60_000 + 14 * 86_400_000).toISOString().slice(0, 10);

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
  const snooze = async (c) => {
    const reason = window.prompt(`Why can "${c.title}" wait?`);
    if (!reason || !reason.trim()) return;
    const until = window.prompt('Until which day? (YYYY-MM-DD, within six months)', twoWeeksOn());
    if (!until) return;
    try {
      await snoozeHealthCheck(c.id, { reason: reason.trim(), until: until.trim() });
      notify.success(`Snoozed until ${until.trim()}.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not snoozed.'));
    }
  };
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
    <div className="space-y-3">
      <PageHeader
        entity="privacy"
        title="Data Health"
        description="What is wrong in employee, leave, reader and payroll data, before it costs a payroll. Nothing is changed here."
        actions={
          <span className="flex items-center gap-2">
            <button type="button" className="ui-btn ui-btn-secondary" onClick={load}>Check again</button>
            <MoreButton
              items={[exportMenuItem('Export')]}
              onSelect={(k) => {
                const format = exportFormatFromKey(k);
                if (format) runListExport({ format, title: 'Data Health', fileName: 'Data health', label: 'problem/problems', columns: EXPORT_COLUMNS, rows });
              }}
            />
          </span>
        }
      />
      <div className="pb-8 space-y-4">
        {error ? <p className="ui-card p-4 text-sm" role="alert">{error}</p> : null}
        {!data ? (
          error ? null : <SkeletonCard lines={8} />
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Summary">
              <StatTile label="People checked" value={data.people} hint="active, not left" />
              <StatTile label="Blocks payday" value={data.blocking} hint="people to fix first" tone={data.blocking ? 'neg' : 'pos'} />
              <StatTile label="Checks failing" value={data.checks.length} hint="of the data checks" tone={data.checks.length ? 'warn' : 'pos'} />
              <StatTile label="Checked" value={new Date(data.ranAt).toLocaleTimeString('en-IN', { timeStyle: 'short' })} hint="just now" />
            </section>
            {!data.checks.length ? (
              <EmptyState icon={ShieldCheck} title="Nothing to fix" description="Every check passed: no duplicates, joining dates in place, and payroll has the PAN, UAN, ESIC and bank details it needs." />
            ) : (
              data.checks.map((c) => (
                <section key={c.id} className="ui-card p-4 space-y-2" aria-label={c.title}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`ui-pill ui-pill-${SEVERITY[c.severity]?.tone || 'neutral'}`}>{SEVERITY[c.severity]?.label || c.severity}</span>
                        <span className="ui-caption">{c.area}</span>
                      </div>
                      <h2 className="ui-t-sec">
                        {c.title} <span className="tabular-nums">· {c.count}</span>
                      </h2>
                    </div>
                    <span className="flex items-center gap-2">
                      <button type="button" className="ui-link text-sm" onClick={() => snooze(c)}>Snooze</button>
                      {fixLink(c)}
                    </span>
                  </div>
                  <p className="text-sm">{c.why}</p>
                  <p className="ui-caption">To fix: {c.fix}</p>
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
              ))
            )}
            {data.snoozed?.length ? (
              <section aria-label="Snoozed" className="space-y-2">
                <h2 className="ui-t-sec">Snoozed</h2>
                <ul className="divide-y text-sm">
                  {data.snoozed.map((c) => (
                    <li key={c.id} className="py-2 flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.title}</span>
                      <span className="ui-caption tabular-nums">· {c.count} · back {c.snooze.until} · {c.snooze.reason}</span>
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
    </div>
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
  return (
    <section aria-label="Headcount" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="ui-t-sec">Headcount and movements</h2>
        <label className="flex items-center gap-2 text-sm">As of <input type="date" className="ui-input" style={{ width: 'auto' }} value={asOf} max={today} onChange={(e) => setAsOf(e.target.value || today)} aria-label="As of" /></label>
      </div>
      <p className="text-sm"><span className="tabular-nums font-medium">{data.headcount}</span> {data.headcount === 1 ? 'person' : 'people'} on {data.asOf}{Object.keys(data.byEstablishment).length ? ': ' : ''}{Object.entries(data.byEstablishment).map(([k, v]) => `${k} ${v}`).join(', ')}</p>
      <table className="w-full text-sm">
        <thead><tr className="ui-caption text-left"><th className="py-1.5 font-medium">Month</th><th className="py-1.5 font-medium text-right">Joined</th><th className="py-1.5 font-medium text-right">Left</th><th className="py-1.5 font-medium text-right">Transferred</th><th className="py-1.5 font-medium text-right">At month end</th></tr></thead>
        <tbody className="divide-y">
          {[...data.months].reverse().map((m) => (
            <tr key={m.month}>
              <td className="py-1.5">{m.month}</td>
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
