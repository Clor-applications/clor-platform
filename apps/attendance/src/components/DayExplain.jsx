import React, { useEffect, useState } from 'react';
import { AlertTriangle, Clock, Fingerprint, History, Info, MapPin, ShieldCheck, Smartphone } from '@ui/components/ui/lineIcons';

import Drawer from '@ui/components/ui/Drawer';
import { SkeletonCard } from '@ui/components/ui/Primitives';

const STATUS_LABEL = { PRESENT: 'Present', HALF_DAY: 'Half day', ABSENT: 'Absent', ON_LEAVE: 'On leave', HOLIDAY: 'Holiday', WEEKLY_OFF: 'Weekly off' };
const STATUS_TONE = { PRESENT: 'pos', HALF_DAY: 'warn', ABSENT: 'neg', ON_LEAVE: 'info', HOLIDAY: 'neutral', WEEKLY_OFF: 'neutral' };
const FIELD = { status: 'Status', in: 'In', out: 'Out', workedMinutes: 'Worked', lateMinutes: 'Late', earlyOutMinutes: 'Left early', overtimeMinutes: 'Overtime', overtimeApproved: 'Overtime approved', validated: 'Validated', source: 'Set by', note: 'Note' };
const ACTION = { WRITE: 'Changed', DELETE: 'Removed', VALIDATE: 'Validated', OVERTIME: 'Overtime decision', LEAVE_CANCELLED: 'Leave undone', BULK: 'Bulk change' };
const SOURCE = { DEVICE: 'reader punches', CLOCK: 'app clock-in', MANUAL: 'hand entry', REQUEST: 'correction', LEAVE: 'leave', IMPORT: 'import' };

/* Reader trust (O-11): shown only when the server sends it, i.e. the company has it on. */
const TRUST = {
  TRUSTED: { label: 'Trusted', tone: 'pos', hint: 'Every punch came from a registered reader that was online with its clock right, and reached CLOR in time.' },
  CHECK: { label: 'Check', tone: 'warn', hint: 'At least one punch needs a look before you rely on this day.' },
  MANUAL: { label: 'Manual', tone: 'neutral', hint: 'A person wrote this day; the punches did not.' },
};

const mins = (m) => (m == null ? '—' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);
const show = (field, v) => {
  if (v == null || v === '') return '—';
  if (field === 'status') return STATUS_LABEL[v] || v;
  if (field === 'source') return SOURCE[v] || v;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (/Minutes$/.test(field)) return mins(v);
  return String(v);
};
const when = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayTitle = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Why a day says what it says. Every figure comes from the server, which
 * re-runs the same rules the day was scored with; nothing is worked out here.
 * `load` returns the explanation; `actions` adds buttons (evidence, correct).
 */
export default function DayExplain({ open, onClose, load, actions = null, title = 'Why this day says what it says' }) {
  /* The answer is kept with the request it answers, so a slow reply for the last day never shows under the next. */
  const [result, setResult] = useState({ for: null, data: null, error: '' });
  useEffect(() => {
    if (!open) return undefined;
    let off = false;
    Promise.resolve()
      .then(load)
      .then((d) => !off && setResult({ for: load, data: d, error: '' }))
      .catch((e) => !off && setResult({ for: load, data: null, error: String(e?.message || 'Could not explain this day.') }));
    return () => {
      off = true;
    };
  }, [open, load]);
  const data = result.for === load ? result.data : null;
  const error = result.for === load ? result.error : '';

  const r = data?.record;
  return (
    <Drawer open={open} onClose={onClose} title={title} description={data ? `${data.employee?.name ? `${data.employee.name}, ` : ''}${dayTitle(data.date)}` : ''} actions={actions}>
      {error ? <p className="ui-caption" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
      {!data && !error ? <SkeletonCard lines={6} /> : null}
      {data ? (
        <div className="space-y-5">
          <section className="ui-explain-summary" aria-label="The day">
            <div>
              <span className="ui-caption">Status</span>
              {r ? <span className={`ui-pill ui-pill-${STATUS_TONE[r.status] || 'neutral'}`}>{STATUS_LABEL[r.status] || r.status}</span> : <span className="ui-pill ui-pill-neutral">No record</span>}
            </div>
            <div><span className="ui-caption">In</span><strong className="tabular-nums">{r?.in || '—'}</strong></div>
            <div><span className="ui-caption">Out</span><strong className="tabular-nums">{r?.out || '—'}</strong></div>
            <div><span className="ui-caption">Worked</span><strong className="tabular-nums">{r ? mins(r.workedMinutes) : '—'}</strong></div>
            <div><span className="ui-caption">Late</span><strong className="tabular-nums">{r?.lateMinutes ? `${r.lateMinutes} min` : '—'}</strong></div>
            <div><span className="ui-caption">Overtime</span><strong className="tabular-nums">{r?.overtimeMinutes ? `${mins(r.overtimeMinutes)}${r.overtimeApproved ? '' : ' (not approved)'}` : '—'}</strong></div>
          </section>

          {data.trust ? (
            <section aria-labelledby="explain-trust">
              <h3 id="explain-trust" className="ui-t-sec mb-2 flex items-center gap-2">
                <ShieldCheck size={15} aria-hidden="true" /> Reader trust
                <span className={`ui-pill ui-pill-${TRUST[data.trust.level]?.tone || 'neutral'}`}>{TRUST[data.trust.level]?.label || data.trust.level}</span>
              </h3>
              <p className="ui-caption mb-1">{TRUST[data.trust.level]?.hint}</p>
              <ul className="ui-explain-steps" aria-label="Why">
                {data.trust.reasons.map((x, i) => (
                  <li key={i} data-kind={data.trust.level === 'CHECK' ? 'mismatch' : 'info'}>
                    {data.trust.level === 'CHECK' ? <AlertTriangle size={15} aria-hidden="true" /> : <Info size={15} aria-hidden="true" />}
                    <span>{x.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="explain-steps">
            <h3 id="explain-steps" className="ui-t-sec mb-2">How it was worked out</h3>
            <ol className="ui-explain-steps">
              {data.steps.map((s, i) => (
                <li key={i} data-kind={s.kind}>
                  {s.kind === 'mismatch' ? <AlertTriangle size={15} aria-hidden="true" /> : s.kind === 'shift' ? <Clock size={15} aria-hidden="true" /> : s.kind === 'punches' ? <Fingerprint size={15} aria-hidden="true" /> : <Info size={15} aria-hidden="true" />}
                  <span>{s.text}</span>
                </li>
              ))}
            </ol>
            <p className="ui-caption mt-2">Shift window {data.window?.start}–{data.window?.end}. Grace {data.shift?.graceMinutes} min, half day {mins(data.shift?.halfDayMinutes)}, full day {mins(data.shift?.fullDayMinutes)} or the shift worked as scheduled.{data.monthClosed ? ' This month is closed.' : ''}</p>
          </section>

          <section aria-labelledby="explain-punches">
            <h3 id="explain-punches" className="ui-t-sec mb-2">Punches</h3>
            {data.punches.length ? (
              <ul className="divide-y text-sm">
                {data.punches.map((p, i) => (
                  <li key={i} className="flex items-center gap-3 py-1.5">
                    {p.where === 'the app' ? <Smartphone size={15} aria-hidden="true" className="ui-subtle" /> : /phone/i.test(p.where) ? <MapPin size={15} aria-hidden="true" className="ui-subtle" /> : <Fingerprint size={15} aria-hidden="true" className="ui-subtle" />}
                    <strong className="tabular-nums">{p.time}</strong>
                    <span className="ui-caption">{p.kind === 'IN' ? 'In' : p.kind === 'OUT' ? 'Out' : 'Punch'}</span>
                    <span className="min-w-0 flex-1 truncate text-right ui-caption">{p.where}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ui-muted text-sm">No punches for this day.</p>
            )}
          </section>

          {data.corrections?.length ? (
            <section aria-labelledby="explain-corrections">
              <h3 id="explain-corrections" className="ui-t-sec mb-2">Corrections</h3>
              <ul className="space-y-2 text-sm">
                {data.corrections.map((c) => (
                  <li key={c.id} className="ui-explain-item">
                    <div className="flex items-center justify-between gap-2">
                      <span>Asked for {c.in || '—'}–{c.out || '—'}</span>
                      <span className={`ui-pill ui-pill-${c.status === 'APPROVED' ? 'pos' : c.status === 'REJECTED' ? 'neg' : 'warn'}`}>{c.status.toLowerCase()}</span>
                    </div>
                    <p className="ui-caption">{c.reason}{c.reviewNote ? ` · Note: ${c.reviewNote}` : ''}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="explain-history">
            <h3 id="explain-history" className="ui-t-sec mb-2 flex items-center gap-2"><History size={15} aria-hidden="true" /> History</h3>
            {data.history?.length ? (
              <ol className="ui-explain-history">
                {data.history.map((h) => (
                  <li key={h.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <strong className="text-sm">{ACTION[h.action] || h.action}</strong>
                      <span className="ui-caption">{when(h.at)} · {h.by}</span>
                    </div>
                    {h.reason ? <p className="ui-caption">{h.reason}</p> : null}
                    {h.changes?.length ? (
                      <dl className="ui-explain-diff">
                        {h.changes.filter((c) => c.field !== 'note').map((c) => (
                          <div key={c.field}>
                            <dt>{FIELD[c.field] || c.field}</dt>
                            <dd><s>{show(c.field, c.before)}</s> <span aria-hidden="true">→</span><span className="sr-only">became</span> {show(c.field, c.after)}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="ui-muted text-sm">No changes recorded since history began.</p>
            )}
            {r?.validatedBy ? <p className="ui-caption mt-2">Validated by {r.validatedBy}{r.validatedAt ? ` on ${when(r.validatedAt)}` : ''}.</p> : null}
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}
