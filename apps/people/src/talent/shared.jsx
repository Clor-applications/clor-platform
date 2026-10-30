import React, { useRef, useState } from 'react';
import Drawer from '@ui/components/ui/Drawer';
import SuggestInput from '@ui/components/ui/SuggestInput';
import ErrorState from '@ui/components/ui/ErrorState';
import { Button } from '@ui/components/ui/Primitives';
import { formatDate } from '@ui/components/ui/DatePicker';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import useRequest from '@ui/components/ui/useRequest';
import { usePermissions } from '@ui/permissions/usePermissions';
import { listAllEmployees } from '@ui/personnel/api';

/* Talent's words and small parts, shared by its screens (TALENT-DECISIONS.md). */

export const STAGES = [
  ['APPLIED', 'Applied', 'ui-pill-neutral'],
  ['SCREENING', 'Screening', 'ui-pill-info'],
  ['INTERVIEW', 'Interview', 'ui-pill-info'],
  ['OFFER', 'Offer', 'ui-pill-warn'],
  ['HIRED', 'Hired', 'ui-pill-pos'],
  ['REJECTED', 'Not taken forward', 'ui-pill-neutral'],
  ['WITHDRAWN', 'Withdrew', 'ui-pill-neutral'],
];
export const OPEN_STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];
export const OPENING_STATUS = {
  REQUESTED: ['Asked for', 'ui-pill-warn'],
  DRAFT: ['Draft', 'ui-pill-neutral'],
  OPEN: ['Open', 'ui-pill-pos'],
  ON_HOLD: ['On hold', 'ui-pill-neutral'],
  FILLED: ['Filled', 'ui-pill-pos'],
  CLOSED: ['Closed', 'ui-pill-neutral'],
};
export const SOURCES = [['REFERRAL', 'Referral'], ['JOB_PORTAL', 'Job portal'], ['WALK_IN', 'Walk-in'], ['AGENCY', 'Agency'], ['WEBSITE', 'Website'], ['APPLY_LINK', 'Apply link'], ['INTERNAL', 'Works here'], ['OTHER', 'Other']];
export const RECOMMENDATIONS = [['STRONG_YES', 'Strong yes'], ['YES', 'Yes'], ['NO', 'No'], ['STRONG_NO', 'Strong no']];
export const MODES = [['IN_PERSON', 'In person'], ['PHONE', 'Phone'], ['VIDEO', 'Video']];
export const HEALTH = { ON_TRACK: ['On track', 'ui-pill-pos'], AT_RISK: ['At risk', 'ui-pill-warn'], BEHIND: ['Behind', 'ui-pill-neg'] };
export const RATINGS = [[1, 'Well below what was expected'], [2, 'Below what was expected'], [3, 'What was expected'], [4, 'Above what was expected'], [5, 'Well above what was expected']];
export const CYCLE_STATUS = { DRAFT: ['Draft', 'ui-pill-neutral'], OPEN: ['Open', 'ui-pill-info'], CALIBRATING: ['Calibrating', 'ui-pill-warn'], SHARED: ['Shared', 'ui-pill-pos'], CLOSED: ['Closed', 'ui-pill-neutral'] };
export const PLAN_STATUS = { ACTIVE: ['Running', 'ui-pill-info'], EXTENDED: ['Extended', 'ui-pill-warn'], COMPLETED: ['Completed', 'ui-pill-pos'], NOT_MET: ['Not met', 'ui-pill-neg'], CANCELLED: ['Cancelled', 'ui-pill-neutral'] };

export const word = (list, key) => (Array.isArray(list) ? list.find((x) => x[0] === key)?.[1] : list[key]?.[0]) || key || '';
export const Pill = ({ map, value }) => {
  const entry = Array.isArray(map) ? map.find((x) => x[0] === value) : map[value] && [value, ...map[value]];
  if (!entry) return value ? <span className="ui-pill ui-pill-neutral">{value}</span> : null;
  return <span className={`ui-pill ${entry[2] || 'ui-pill-neutral'}`}>{entry[1]}</span>;
};
export const ratingWord = (n) => (n ? `${n} · ${RATINGS.find((r) => r[0] === n)?.[1] || ''}` : '');

export const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const istDay = (d) => new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10);
export const day = (d) => (!d ? '' : /^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? formatDate(String(d)) : formatDate(istDay(d)));
export const when = (d) => (d ? `${day(d)}, ${new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}` : '');
/** A datetime-local value (IST) from a stored instant, and back. */
export const toLocalInput = (d) => (d ? new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 16) : '');
export const fromLocalInput = (v) => (v ? new Date(`${v}:00+05:30`).toISOString() : '');

/**
 * State that a screen param opens (a notice about one candidate, one cycle): it starts from the
 * param and follows it when the param changes while the screen is showing, and the person can
 * still change it. The param is compared during render, not in an effect.
 */
export function useParamState(value, fallback = null) {
  const [state, setState] = useState(value || fallback);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value) setState(value);
  }
  return [state, setState];
}

export const usePerm = () => {
  const perms = usePermissions();
  return (key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
};

/** People who work here, for pickers: name and code only. */
export function useStaff(enabled = true) {
  const req = useRequest(() => (enabled ? listAllEmployees({ status: 'CURRENT' }).then((r) => (r?.employees || []).filter((e) => e.status !== 'LEFT')).catch(() => []) : Promise.resolve([])), [enabled]);
  return req.data || [];
}
export const staffOptions = (staff) => staff.map((p) => ({ value: p.id, label: p.code ? `${p.name} (${p.code})` : p.name }));

/** Status tabs over a list, with the moving indicator every People list has. */
export function Tabs({ label, tabs, value, onChange }) {
  const ref = useRef(null);
  const indicator = useTabIndicator(ref, value);
  return (
    <div ref={ref} role="tablist" aria-label={label} className={`ui-record-tablist ${indicator ? 'has-indicator' : ''}`}>
      {tabs.map(([k, l, n]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={`ui-tab ${value === k ? 'is-active' : ''}`} onClick={() => onChange(k)}>
          {l}{n ? <span className="ui-tab-count tabular-nums">{n}</span> : null}
        </button>
      ))}
      {indicator}
    </div>
  );
}

/** An error inside a form: the server's words when it said no, a plain line when the form did. */
export const FormError = ({ error }) => (error ? (
  <div className="sm:col-span-2"><ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /></div>
) : null);

/** A drawer's footer: Cancel and the one action. */
/* Save keeps its label while it works: the shared loading state shows a spinner and refuses a second click (DESIGN.md, Buttons). */
export const Footer = ({ onCancel, onSave, busy, label, disabled = false }) => (
  <>
    <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel}>Cancel</button>
    <Button variant="primary" loading={Boolean(busy)} disabled={disabled} onClick={onSave}>{label}</Button>
  </>
);

/** What other rows already say in a field, most used first (SuggestInput). */
export const usedValues = (rows, pick) => {
  const n = new Map();
  for (const r of rows || []) {
    const v = String(pick(r) ?? '').trim();
    if (v) n.set(v, (n.get(v) || 0) + 1);
  }
  return [...n].sort((a, b) => b[1] - a[1]).map(([v]) => v);
};

export const SHEET = 'w-[min(40rem,96vw)] ui-drawer-sheet';
export const WIDE_SHEET = 'w-[min(48rem,96vw)] ui-drawer-sheet';

/**
 * A reason asked for before a step that needs one (closing an opening, not taking a candidate
 * forward): it stays on the record, so it is asked for, not guessed.
 */
export function ReasonDrawer({ title, label, help, action, suggestions = [], onClose, onDone }) {
  const [text, setText] = useState('');
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async () => {
    if (!text.trim()) { setMissing(true); return; }
    setBusy(true);
    setError(null);
    try { await onDone(text.trim()); } catch (e) { setError(e); setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title={title} dirty={Boolean(text.trim())}
      footer={<Footer onCancel={onClose} onSave={go} busy={busy} label={action} />}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <FormError error={error} />
        <label className="block sm:col-span-2"><span className="ui-label">{label} *</span>
          <SuggestInput value={text} autoFocus maxLength={500} aria-invalid={missing || undefined} onChange={(v) => { setText(v); setMissing(false); }} suggestions={suggestions} />
          {missing ? <span className="ui-field-error">{help}</span> : null}
        </label>
      </form>
    </Drawer>
  );
}
