import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, RefreshCw } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { notify } from '@ui/components/ui/notify';
import { getReaderHealth, saveReaderAlertSettings } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

const ago = (iso) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};
const STATUS = {
  ok: { label: 'Healthy', dot: 'rgb(var(--pos))' },
  warn: { label: 'Needs a look', dot: 'rgb(var(--warn-ink, 180 120 0))' },
  bad: { label: 'Problem', dot: 'rgb(var(--neg))' },
  offline: { label: 'Offline', dot: 'rgb(var(--neg))' },
  off: { label: 'Switched off', dot: 'rgb(var(--fg-subtle, 150 150 150))' },
};
const SEVERITY_PILL = { critical: 'ui-pill-neg', high: 'ui-pill-neg', medium: 'ui-pill-warn' };
const clock = (sec) => {
  if (sec === null || sec === undefined) return 'checked at the next punch';
  const a = Math.abs(sec);
  if (a < 60) return 'correct';
  return `${a < 3600 ? `${Math.round(a / 60)} min` : a < 172_800 ? `${(a / 3600).toFixed(1)} h` : `${Math.round(a / 86_400)} days`} ${sec > 0 ? 'ahead' : 'behind'}`;
};

/**
 * Every reader at a glance: is it reporting, is its clock right, how full is
 * it, is anything stuck — and is attendance arriving at all today. Problems
 * are e-mailed once when they start and once when they clear.
 */
export default function ReaderHealth() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const load = useCallback(() => {
    getReaderHealth().then((v) => { setData(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load reader health.')));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) return loadError ? <LoadFailed message={loadError} onRetry={load} /> : <SkeletonCard lines={8} />;
  const open = data.alerts.filter((a) => !a.resolvedAt);
  const recent = data.alerts.filter((a) => a.resolvedAt).slice(0, 10);
  const problems = data.readers.filter((r) => r.status !== 'ok' && r.status !== 'off').length;

  return (
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="Reader health"
        description={`${data.readers.length} reader${data.readers.length === 1 ? '' : 's'} · ${problems ? `${problems} need${problems === 1 ? 's' : ''} a look` : 'all healthy'} · ${data.punchesToday} punch${data.punchesToday === 1 ? '' : 'es'} today`}
        actions={
          <>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={load}><RefreshCw size={16} aria-hidden="true" /> Refresh</button>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setSettingsOpen(true)}><BellRing size={16} aria-hidden="true" /> Alerts</button>
          </>
        }
      />

      {data.collection.map((i) => (
        <div key={i.kind} className="ui-card border-l-4 p-4" role="alert" style={{ borderLeftColor: 'rgb(var(--neg))' }}>
          <div className="font-semibold">{i.title}</div>
          <p className="text-sm">{i.details}</p>
        </div>
      ))}
      {!data.settings.alertEmails ? (
        <div className="ui-card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <span>Nobody is e-mailed when a reader goes offline. Name who should be.</span>
          <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={() => setSettingsOpen(true)}>Set up alerts</button>
        </div>
      ) : null}

      {!data.readers.length ? (
        <EmptyState title="No readers yet" description="Add a reader under Readers. Its health shows here once it connects." />
      ) : (
        <div className="gap-3 lg:columns-2 2xl:columns-3 [&>*]:mb-3 [&>*]:break-inside-avoid">
          {data.readers.map((r) => {
            const st = STATUS[r.status] || STATUS.ok;
            return (
              <section key={r.id} className="ui-card space-y-2.5 p-4" aria-label={r.name}>
                <header className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: st.dot }} aria-hidden="true" />
                      <h2 className="truncate font-semibold">{r.name}</h2>
                    </div>
                    <div className="ui-caption truncate">
                      {[r.serialNumber, r.model, r.firmware && `firmware ${r.firmware}`, r.ip && `IP ${r.ip}`, r.areaName && `${r.areaName} area`].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <span className="ui-caption shrink-0">{st.label}</span>
                </header>
                <dl className="grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="ui-caption">Last heard</dt><dd className="font-medium">{ago(r.lastSeenAt)}</dd></div>
                  <div><dt className="ui-caption">Last punch</dt><dd className="font-medium">{ago(r.lastPunchAt)}</dd></div>
                  <div><dt className="ui-caption">Clock</dt><dd className="font-medium" style={r.clockOffsetSec && Math.abs(r.clockOffsetSec) >= 120 ? { color: 'rgb(var(--neg))' } : undefined}>{clock(r.clockOffsetSec)}</dd></div>
                </dl>
                <div className="space-y-1.5">
                  {[
                    ['Users', r.capacity.users],
                    ['Fingerprints', r.capacity.fingers],
                    ['Faces', r.capacity.faces],
                    ['Punch log', r.capacity.punches],
                  ].map(([label, c]) =>
                    !c || c.n === null ? null : (
                      <div key={label} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-xs">
                        <span className="ui-caption">{label}</span>
                        <span className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: 'rgb(var(--border))' }} role="meter" aria-label={`${label} used`} aria-valuemin={0} aria-valuemax={c.max || 0} aria-valuenow={c.n}>
                          {c.pct !== null ? (
                            <span className="block h-full rounded-full" style={{ width: `${Math.min(100, c.pct)}%`, backgroundColor: c.pct >= 90 ? 'rgb(var(--neg))' : 'rgb(var(--accent))' }} />
                          ) : null}
                        </span>
                        <span className="tabular-nums">{c.n.toLocaleString('en-IN')}{c.max ? ` / ${c.max.toLocaleString('en-IN')}` : ''}</span>
                      </div>
                    )
                  )}
                  {r.capacity.users.n === null ? <p className="ui-caption">Counts come with the next report.</p> : null}
                  {r.faceSupported === false ? <p className="ui-caption">Fingerprint only.</p> : null}
                </div>
                {r.queue.waiting || r.queue.failed24h ? (
                  <p className="ui-caption">{[r.queue.waiting && `${r.queue.waiting} change${r.queue.waiting === 1 ? '' : 's'} waiting`, r.queue.failed24h && `${r.queue.failed24h} failed today`].filter(Boolean).join(' · ')}</p>
                ) : null}
                {r.issues.length ? (
                  <ul className="space-y-2">
                    {r.issues.map((i) => (
                      <li key={i.kind} className="rounded-lg p-2 text-sm" style={{ backgroundColor: 'rgb(var(--app-bg))' }}>
                        <span className={`ui-pill mr-2 ${SEVERITY_PILL[i.severity]}`}>{i.severity === 'medium' ? 'check' : 'fix'}</span>
                        <span className="font-medium">{i.title}</span>
                        <p className="ui-caption mt-1">{i.details}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      {open.length || recent.length ? (
        <section className="ui-card p-4" aria-labelledby="alerts-h">
          <h2 id="alerts-h" className="ui-t-sec mb-2">Alerts</h2>
          <ul className="divide-y text-sm" style={{ borderColor: 'rgb(var(--border))' }}>
            {[...open, ...recent].map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{a.title}</span>
                  <span className="ui-caption block">
                    since {new Date(a.openedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    {a.resolvedAt ? ` · cleared ${ago(a.resolvedAt)}` : ''}
                    {a.notifiedAt ? ' · e-mailed' : ''}
                    {a.lastError ? ` · e-mail failed: ${a.lastError}` : ''}
                  </span>
                </span>
                <span className={`ui-pill ${a.resolvedAt ? 'ui-pill-pos' : SEVERITY_PILL[a.severity]}`}>{a.resolvedAt ? 'cleared' : 'open'}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {settingsOpen ? <AlertSettings initial={data.settings} onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); load(); }} /> : null}
    </div>
  );
}

function AlertSettings({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const save = async (e) => {
    e.preventDefault();
    try {
      await saveReaderAlertSettings({ ...form, offlineAlertMinutes: Number(form.offlineAlertMinutes), noPunchAfterHour: Number(form.noPunchAfterHour) });
      notify.success('Alert settings saved.');
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    }
  };
  return (
    <Drawer
      widthClass="w-[min(40rem,96vw)]"
      open
      onClose={onClose}
      title="Reader alerts"
      description="One e-mail when a problem starts, one when it clears."
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="alert-form" className="ui-btn ui-btn-primary">Save</button>
        </>
      }
    >
      <form id="alert-form" onSubmit={save} className="grid gap-4">
        <label className="block">
          <span className="ui-label">E-mail these people</span>
          <input className="ui-input w-full" value={form.alertEmails} onChange={(e) => setForm({ ...form, alertEmails: e.target.value })} placeholder="it@company.com, hr@company.com" />
          <span className="ui-caption">Separate with commas. Empty = no e-mails (problems still show here).</span>
        </label>
        <label className="block">
          <span className="ui-label">A reader is offline after (minutes)</span>
          <input type="number" min={5} max={1440} className="ui-input w-full" value={form.offlineAlertMinutes} onChange={(e) => setForm({ ...form, offlineAlertMinutes: e.target.value })} />
          <span className="ui-caption">Readers check in every 30 seconds; a short network blip should not wake anyone.</span>
        </label>
        <label className="block">
          <span className="ui-label">“No punches today” after (hour, 24-h)</span>
          <input type="number" min={6} max={20} className="ui-input w-full" value={form.noPunchAfterHour} onChange={(e) => setForm({ ...form, noPunchAfterHour: e.target.value })} />
          <span className="ui-caption">On a working day, if not one punch from any reader has arrived by then, collection is broken — whatever the readers look like.</span>
        </label>
      </form>
    </Drawer>
  );
}
