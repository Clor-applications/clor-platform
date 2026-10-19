import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BellRing, ChevronDown, Cpu, Fingerprint, History, RefreshCw, Router, Wifi } from 'lucide-react';

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

/** One labelled group of facts in a reader card: label on the left, value on the right. */
const Facts = ({ title, rows, note = null }) => (
  <div className="px-4 py-3" style={{ backgroundColor: 'rgb(var(--surface))' }}>
    <p className="text-xs font-semibold uppercase tracking-wide ui-muted mb-2">{title}</p>
    <dl className="space-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3 text-sm">
          <dt className="ui-muted shrink-0">{k}</dt>
          <dd className="min-w-0 truncate text-end font-medium">{v === null || v === undefined || v === '' ? <span className="ui-caption font-normal">Not reported</span> : v}</dd>
        </div>
      ))}
    </dl>
    {note ? <p className="ui-caption mt-1.5">{note}</p> : null}
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
        data.readers.length === 1 ? (
          <ReaderCard r={data.readers[0]} onTimeline={setTimelineOf} />
        ) : (
          <ReaderList readers={data.readers} onTimeline={setTimelineOf} />
        )
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


/**
 * One reader in full: what is wrong first, then four labelled groups. On its
 * own it is a card; opened from the list of several readers it is the row's
 * detail, without a second heading.
 */
function ReaderCard({ r, onTimeline, compact = false }) {
  const st = STATUS[r.status] || STATUS.ok;
  const drift = r.clockOffsetSec !== null && r.clockOffsetSec !== undefined && Math.abs(r.clockOffsetSec) >= 120;
  const memory = [
    ['Users', r.capacity.users],
    ['Fingerprints', r.capacity.fingers],
    ['Faces', r.capacity.faces],
    ['Punch log', r.capacity.punches],
  ];
  return (
    <section className={compact ? '' : 'ui-card overflow-hidden'} aria-label={r.name}>
      {compact ? null : (
      <header className="ui-card-head flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: 'rgb(var(--border))' }}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: st.dot }} aria-hidden="true" />
          <h2 className="truncate ui-t-sec">{r.name}</h2>
          <span className={`ui-pill ${st.pill}`}>{st.label}</span>
          <span className="ui-caption truncate">{[r.serialNumber, r.areaName].filter(Boolean).join(' · ')}</span>
        </div>
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" title="Punches received, changes sent, errors" aria-label={`${r.name} timeline`} onClick={() => onTimeline(r)}>
          <History size={14} aria-hidden="true" /> Timeline
        </button>
      </header>
      )}

      {r.issues.length ? (
        <ul className="border-b" style={{ borderColor: 'rgb(var(--border))' }}>
          {r.issues.map((i) => (
            <li key={i.kind} className="flex items-start gap-3 px-4 py-3">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: i.severity === 'medium' ? 'rgb(var(--warn-ink, 180 120 0))' : 'rgb(var(--neg))' }} aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-sm font-semibold">{i.title} <span className={`ui-pill ml-1 ${SEVERITY_PILL[i.severity] || 'ui-pill-warn'}`}>{i.severity === 'medium' ? 'Check' : 'Fix now'}</span></div>
                <p className="ui-caption mt-0.5">{i.details}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-px sm:grid-cols-2 2xl:grid-cols-4" style={{ backgroundColor: 'rgb(var(--border))' }}>
        <Facts title="Connection" rows={[
          ['Status', <span key="s" style={{ color: r.online ? 'rgb(var(--pos))' : r.lastSeenAt ? 'rgb(var(--neg))' : undefined }}>{r.online ? 'Online' : r.lastSeenAt ? 'Offline' : 'Never connected'}</span>],
          ['Last heard', r.lastSeenAt ? `${ago(r.lastSeenAt)} · ${when(r.lastSeenAt)}` : 'Never'],
          ['Last punch', r.lastPunchAt ? `${ago(r.lastPunchAt)} · ${when(r.lastPunchAt)}` : 'None yet'],
          ['IP address', r.ip],
        ]} />
        <Facts title="Clock and changes" rows={[
          ['Clock', <span key="c" style={drift ? { color: 'rgb(var(--neg))' } : undefined}>{r.clockOffsetSec === null || r.clockOffsetSec === undefined ? 'Not checked yet' : clock(r.clockOffsetSec)}</span>],
          ['Checked', r.clockCheckedAt ? ago(r.clockCheckedAt) : 'At the next punch'],
          ['Changes waiting', String(r.queue.waiting)],
          ['Failed today', <span key="f" style={r.queue.failed24h ? { color: 'rgb(var(--neg))' } : undefined}>{r.queue.failed24h}</span>],
        ]} />
        <Facts title="Memory used" rows={memory.map(([label, c]) => [
          label,
          c?.n === null || c?.n === undefined ? null : (
            <span key={label} className="inline-flex items-center gap-2">
              {c.pct !== null && c.pct !== undefined ? (
                <span className="h-1.5 w-12 overflow-hidden rounded-full" style={{ backgroundColor: 'rgb(var(--border))' }} aria-hidden="true">
                  <span className="block h-full rounded-full" style={{ width: `${Math.min(100, c.pct)}%`, backgroundColor: c.pct >= 90 ? 'rgb(var(--neg))' : 'rgb(var(--fg-muted))' }} />
                </span>
              ) : null}
              <span className="tabular-nums">{c.n.toLocaleString('en-IN')}{c.max ? ` / ${c.max.toLocaleString('en-IN')}` : ''}</span>
            </span>
          ),
        ])} note={r.capacity.users.n === null ? 'Sent with the reader’s next info report.' : null} />
        <Facts title="Device" rows={[
          ['Model', r.model],
          ['Firmware', r.firmware],
          ['Recognises', [r.fingerSupported && 'Fingerprint', r.faceSupported && 'Face'].filter(Boolean).join(', ') || null],
          ['Last info', when(r.infoAt)],
        ]} />
      </div>
    </section>
  );
}

/* Worst first: a reader that needs fixing is the one somebody opened this page for. */
const RANK = { bad: 0, offline: 1, warn: 2, delayed: 3, ok: 4, off: 5 };
const fullest = (r) =>
  [['users', r.capacity.users], ['fingerprints', r.capacity.fingers], ['faces', r.capacity.faces], ['punch log', r.capacity.punches]]
    .filter(([, c]) => c && c.pct !== null && c.pct !== undefined)
    .sort((a, b) => b[1].pct - a[1].pct)[0] || null;

/**
 * Several readers: one row each, worst first, so twenty readers fit on a
 * screen and the ones with a problem are at the top. A row opens the
 * reader's full detail beneath it.
 */
function ReaderList({ readers, onTimeline }) {
  const sorted = [...readers].sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || a.name.localeCompare(b.name));
  const [openId, setOpenId] = useState(null);
  return (
    <div className="ui-card overflow-hidden">
      <div className="ui-table-scroll">
        <table className="ui-table w-full">
          <thead>
            <tr>
              <th scope="col">Reader</th>
              <th scope="col" className="ui-col-h-center">Status</th>
              <th scope="col">Last heard</th>
              <th scope="col" className="hidden lg:table-cell">Last punch</th>
              <th scope="col" className="hidden sm:table-cell">Clock</th>
              <th scope="col" className="hidden lg:table-cell">Memory</th>
              <th scope="col" className="hidden sm:table-cell">Needs</th>
              <th scope="col"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody className="ui-rows">
            {sorted.map((r) => {
              const st = STATUS[r.status] || STATUS.ok;
              const isOpen = openId === r.id;
              const full = fullest(r);
              const drift = r.clockOffsetSec !== null && r.clockOffsetSec !== undefined && Math.abs(r.clockOffsetSec) >= 120;
              return (
                <React.Fragment key={r.id}>
                  <tr className="ui-row-click" onClick={() => setOpenId(isOpen ? null : r.id)} aria-expanded={isOpen}>
                    <td className="ui-col-entity">
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: st.dot }} aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block truncate">{r.name}</span>
                          <span className="ui-caption block truncate">{[r.serialNumber, r.areaName, r.model].filter(Boolean).join(' · ')}</span>
                          {r.issues.length ? <span className="block text-xs whitespace-normal sm:hidden" style={{ color: 'rgb(var(--neg))' }}>{r.issues[0].title}</span> : null}
                        </span>
                      </span>
                    </td>
                    <td className="ui-col-h-center"><span className={`ui-pill ${st.pill}`}>{st.label}</span></td>
                    <td style={!r.online && r.isActive && r.lastSeenAt ? { color: 'rgb(var(--neg))' } : undefined}>{r.online ? 'Online' : ago(r.lastSeenAt)}</td>
                    <td className="hidden lg:table-cell">{ago(r.lastPunchAt)}</td>
                    <td className="hidden sm:table-cell" style={drift ? { color: 'rgb(var(--neg))' } : undefined}>{r.clockOffsetSec === null || r.clockOffsetSec === undefined ? <span className="ui-caption">Not checked</span> : clock(r.clockOffsetSec)}</td>
                    <td className="hidden lg:table-cell">
                      {full ? (
                        <span className="inline-flex items-center gap-2" title={`Fullest: ${full[0]}`}>
                          <span className="h-1.5 w-14 overflow-hidden rounded-full" style={{ backgroundColor: 'rgb(var(--border))' }} aria-hidden="true">
                            <span className="block h-full rounded-full" style={{ width: `${Math.min(100, full[1].pct)}%`, backgroundColor: full[1].pct >= 90 ? 'rgb(var(--neg))' : 'rgb(var(--fg-muted))' }} />
                          </span>
                          <span className="tabular-nums" style={full[1].pct >= 90 ? { color: 'rgb(var(--neg))' } : undefined}>{Math.round(full[1].pct)}% {full[0]}</span>
                        </span>
                      ) : <span className="ui-caption">Not reported</span>}
                    </td>
                    <td className="whitespace-normal hidden sm:table-cell">
                      {r.issues.length ? (
                        <span className="text-sm">{r.issues[0].title}{r.issues.length > 1 ? <span className="ui-caption"> +{r.issues.length - 1} more</span> : null}</span>
                      ) : <span className="ui-caption">Nothing</span>}
                    </td>
                    <td className="ui-col-meta">
                      <ChevronDown size={16} aria-hidden="true" style={{ transform: isOpen ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }} />
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr>
                      <td colSpan={8} className="!p-0 whitespace-normal" style={{ backgroundColor: 'rgb(var(--surface-sunken))' }}>
                        <div className="flex justify-end px-4 pt-3">
                          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => onTimeline(r)}><History size={14} aria-hidden="true" /> Timeline</button>
                        </div>
                        <ReaderCard r={r} onTimeline={onTimeline} compact />
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
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
