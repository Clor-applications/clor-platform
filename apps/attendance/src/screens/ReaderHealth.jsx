import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BellRing, CheckCircle2, Cpu, Fingerprint, History, RefreshCw, Router, Wifi, WifiOff } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { StatCards } from '@ui/components/list/ListPageParts';
import { notify } from '@ui/components/ui/notify';
import { getReaderHealth, getReaderTimeline, saveReaderAlertSettings } from '../api/attendance';
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
  ok: { label: 'Healthy', dot: 'rgb(var(--pos))', pill: 'ui-pill-pos' },
  delayed: { label: 'Late checking in', dot: 'rgb(var(--warn-ink, 180 120 0))', pill: 'ui-pill-warn' },
  warn: { label: 'Needs a look', dot: 'rgb(var(--warn-ink, 180 120 0))', pill: 'ui-pill-warn' },
  bad: { label: 'Problem', dot: 'rgb(var(--neg))', pill: 'ui-pill-neg' },
  offline: { label: 'Offline', dot: 'rgb(var(--neg))', pill: 'ui-pill-neg' },
  off: { label: 'Switched off', dot: 'rgb(var(--fg-subtle, 150 150 150))', pill: 'ui-pill-neutral' },
};
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null);

/** One figure in a reader card: a label, the value, and what it means. */
const Metric = ({ label, value, hint, tone }) => (
  <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'rgb(var(--surface-sunken))' }}>
    <dt className="ui-caption">{label}</dt>
    <dd className="text-sm font-semibold tabular-nums" style={tone ? { color: `rgb(var(--${tone}))` } : undefined}>{value}</dd>
    {hint ? <dd className="ui-caption truncate" title={hint}>{hint}</dd> : null}
  </div>
);
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
  const [timelineOf, setTimelineOf] = useState(null);
  const load = useCallback(() => {
    getReaderHealth().then((v) => { setData(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load reader health.')));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) {
    return (
      <div className="space-y-3">
        <PageHeader entity="reader" title="Reader health" />
        <div className="pb-8 space-y-6">{loadError ? <LoadFailed message={loadError} onRetry={load} /> : <SkeletonCard lines={8} />}</div>
      </div>
    );
  }
  const open = data.alerts.filter((a) => !a.resolvedAt);
  const recent = data.alerts.filter((a) => a.resolvedAt).slice(0, 10);
  const problems = data.readers.filter((r) => r.status !== 'ok' && r.status !== 'off').length;

  return (
    <div className="space-y-3">
      <PageHeader
        entity="reader"
        title="Reader health"
        description="Is each reader reporting, is its clock right, how full is it. Problems are e-mailed once when they start and once when they clear."
        actions={
          <>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={load}><RefreshCw size={16} aria-hidden="true" /> Refresh</button>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setSettingsOpen(true)}><BellRing size={16} aria-hidden="true" /> Alerts</button>
          </>
        }
      />

      <StatCards
        dense
        cards={[
          { label: 'Readers', value: data.readers.length, count: true, tone: 'sent', Icon: Cpu },
          { label: 'Online now', value: data.readers.filter((r) => r.online).length, count: true, tone: 'paid', Icon: Wifi },
          { label: 'Need a look', value: problems, count: true, tone: 'overdue', Icon: AlertTriangle },
          { label: 'Punches today', value: data.punchesToday, count: true, tone: 'partial', Icon: Fingerprint },
          { label: 'Open alerts', value: open.length, count: true, tone: 'outstanding', Icon: BellRing },
        ]}
      />

      <div className="pb-8 space-y-6">
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
        <EmptyState icon={Router} title="No readers yet" description="Add a reader under Readers. Its health shows here once it connects." />
      ) : (
        <div className={`grid gap-3 items-start ${data.readers.length > 1 ? 'xl:grid-cols-2' : ''} ${data.readers.length > 2 ? '2xl:grid-cols-3' : ''}`}>
          {data.readers.map((r) => {
            const st = STATUS[r.status] || STATUS.ok;
            const drift = r.clockOffsetSec !== null && r.clockOffsetSec !== undefined && Math.abs(r.clockOffsetSec) >= 120;
            const facts = [
              ['Model', r.model],
              ['Firmware', r.firmware],
              ['IP address', r.ip],
              ['MAC', r.mac],
              ['Site', r.areaName],
              ['Recognises', [r.fingerSupported && 'fingerprint', r.faceSupported && 'face'].filter(Boolean).join(' and ') || null],
              ['Last info', when(r.infoAt)],
            ];
            return (
              <section key={r.id} className="ui-card p-4 space-y-3" aria-label={r.name}>
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: st.dot }} aria-hidden="true" />
                      <h2 className="truncate ui-t-sec">{r.name}</h2>
                      <span className={`ui-pill ${st.pill}`}>{st.label}</span>
                    </div>
                    <div className="ui-caption truncate mt-0.5">{[r.serialNumber, r.areaName && `${r.areaName}`, r.isActive ? null : 'switched off'].filter(Boolean).join(' · ')}</div>
                  </div>
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm shrink-0" title="Punches received, changes sent, errors" aria-label={`${r.name} timeline`} onClick={() => setTimelineOf(r)}>
                    <History size={14} aria-hidden="true" /> Timeline
                  </button>
                </header>

                <dl className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
                  <Metric label="Last heard" value={ago(r.lastSeenAt)} hint={r.online ? 'Connected' : when(r.lastSeenAt) || 'Never connected'} tone={r.online ? 'pos' : r.lastSeenAt ? 'neg' : undefined} />
                  <Metric label="Last punch" value={ago(r.lastPunchAt)} hint={when(r.lastPunchAt)} />
                  <Metric label="Clock" value={r.clockOffsetSec === null || r.clockOffsetSec === undefined ? 'Not checked' : clock(r.clockOffsetSec)} hint={r.clockCheckedAt ? `checked ${ago(r.clockCheckedAt)}` : 'at the next punch'} tone={drift ? 'neg' : undefined} />
                  <Metric label="Changes waiting" value={r.queue.waiting} hint={r.queue.failed24h ? `${r.queue.failed24h} failed today` : 'none failed'} tone={r.queue.failed24h ? 'neg' : undefined} />
                </dl>

                <div className={`grid gap-x-6 gap-y-3 ${data.readers.length === 1 ? 'lg:grid-cols-2' : ''}`}>
                <div>
                  <div className="ui-caption mb-1.5">Memory on the reader</div>
                  <div className="space-y-1.5">
                    {[
                      ['Users', r.capacity.users],
                      ['Fingerprints', r.capacity.fingers],
                      ['Faces', r.capacity.faces],
                      ['Punch log', r.capacity.punches],
                    ].map(([label, c]) => (
                      <div key={label} className="grid grid-cols-[6.5rem_1fr_7rem] items-center gap-2 text-xs">
                        <span className="ui-caption">{label}</span>
                        <span className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: 'rgb(var(--border))' }} role="meter" aria-label={`${label} used`} aria-valuemin={0} aria-valuemax={c?.max || 0} aria-valuenow={c?.n || 0}>
                          {c?.pct !== null && c?.pct !== undefined ? (
                            <span className="block h-full rounded-full" style={{ width: `${Math.min(100, c.pct)}%`, backgroundColor: c.pct >= 90 ? 'rgb(var(--neg))' : 'rgb(var(--fg-muted))' }} />
                          ) : null}
                        </span>
                        <span className="tabular-nums text-end">
                          {c?.n === null || c?.n === undefined ? <span className="ui-caption">—</span> : `${c.n.toLocaleString('en-IN')}${c.max ? ` / ${c.max.toLocaleString('en-IN')}` : ''}`}
                        </span>
                      </div>
                    ))}
                  </div>
                  {r.capacity.users.n === null ? <p className="ui-caption mt-1.5">The reader sends these counts with its next info report.</p> : null}
                </div>

                <div>
                  <div className="ui-caption mb-1.5">About the reader</div>
                  <dl className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-x-3 gap-y-1.5 text-xs">
                    {facts.map(([k, v]) => (
                      <div key={k} className="min-w-0">
                        <dt className="ui-caption">{k}</dt>
                        <dd className="truncate" title={v || ''}>{v || <span className="ui-caption">Not reported</span>}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                </div>

                {r.issues.length ? (
                  <ul className="space-y-2">
                    {r.issues.map((i) => (
                      <li key={i.kind} className="rounded-lg p-3 text-sm" style={{ backgroundColor: 'rgb(var(--surface-sunken))' }}>
                        <div className="flex items-center gap-2">
                          <span className={`ui-pill ${SEVERITY_PILL[i.severity] || 'ui-pill-warn'}`}>{i.severity === 'medium' ? 'Check' : 'Fix now'}</span>
                          <span className="font-medium">{i.title}</span>
                        </div>
                        <p className="ui-caption mt-1">{i.details}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="flex items-center gap-1.5 text-sm" style={{ color: 'rgb(var(--pos))' }}>
                    {r.online ? <CheckCircle2 size={16} aria-hidden="true" /> : <WifiOff size={16} aria-hidden="true" />} {r.online ? 'Nothing to fix.' : 'No problems recorded.'}
                  </p>
                )}
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
      </div>

      {settingsOpen ? <AlertSettings initial={data.settings} onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); load(); }} /> : null}
      {timelineOf ? <ReaderTimeline reader={timelineOf} onClose={() => setTimelineOf(null)} /> : null}
    </div>
  );
}

const TONE = { ok: 'pos', warn: 'warn', bad: 'neg', info: 'neutral' };
const KIND_WORD = { batch: 'Punches', command: 'Change', log: 'Reader log', alert: 'Alert' };

/**
 * One reader, as a stream: every batch of punches it sent (with its trace id,
 * how many were new and how many repeats), every change sent to it and what
 * it answered, its own error log and the alerts it raised. The changes still
 * waiting are listed first.
 */
function ReaderTimeline({ reader, onClose }) {
  const [days, setDays] = useState(7);
  const [result, setResult] = useState({ for: null, data: null, error: '' });
  useEffect(() => {
    let off = false;
    const key = `${reader.id}:${days}`;
    getReaderTimeline(reader.id, days)
      .then((d) => !off && setResult({ for: key, data: d, error: '' }))
      .catch((e) => !off && setResult({ for: key, data: null, error: String(e?.message || 'Could not load the timeline.') }));
    return () => { off = true; };
  }, [reader.id, days]);
  const current = result.for === `${reader.id}:${days}`;
  const data = current ? result.data : null;
  const error = current ? result.error : '';
  return (
    <Drawer open onClose={onClose} title={`${reader.name}: timeline`} description={data ? `Last heard ${ago(data.reader.lastSeenAt)} · last new punches ${ago(data.lastPunchBatchAt)}` : ''} widthClass="w-[min(40rem,96vw)]">
      <div className="mb-3 flex items-center gap-2">
        <span className="ui-caption">Show</span>
        {[1, 7, 30].map((n) => (
          <button key={n} type="button" className="ui-segment" aria-selected={days === n} role="tab" onClick={() => setDays(n)}>{n === 1 ? 'Today' : `${n} days`}</button>
        ))}
      </div>
      {error ? <p className="ui-caption" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
      {!data && !error ? <SkeletonCard lines={6} /> : null}
      {data ? (
        <div className="space-y-5">
          {data.pending.length ? (
            <section aria-labelledby="pending-h">
              <h3 id="pending-h" className="ui-t-sec mb-2">Waiting to reach the reader ({data.pending.length})</h3>
              <ul className="divide-y text-sm">
                {data.pending.slice(0, 50).map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-1.5">
                    <span>{c.what}{c.lastError ? <span className="ui-caption block">{c.lastError}</span> : null}</span>
                    <span className={`ui-pill ui-pill-${c.status === 'FAILED' ? 'neg' : 'warn'}`}>{c.status === 'FAILED' ? 'failed' : c.status === 'SENT' ? `sent, ${c.attempts}×` : 'waiting'}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section aria-labelledby="events-h">
            <h3 id="events-h" className="ui-t-sec mb-2">What happened</h3>
            {data.events.length ? (
              <ol className="ui-timeline">
                {data.events.map((e, i) => (
                  <li key={i} data-tone={e.tone}>
                    <span className="ui-timeline-dot" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">{e.title}</span>
                        <span className="ui-caption">{new Date(e.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p className="ui-caption">
                        <span className={`ui-pill ui-pill-${TONE[e.tone] || 'neutral'} mr-1.5`}>{KIND_WORD[e.kind] || e.kind}</span>
                        {e.detail}{e.traceId ? <span className="ui-mono"> · trace {e.traceId.slice(0, 8)}</span> : null}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="ui-muted text-sm">Nothing in this period.</p>
            )}
          </section>
        </div>
      ) : null}
    </Drawer>
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
