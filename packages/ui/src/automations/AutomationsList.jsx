import React, { useMemo, useState } from 'react';

import { PageHeader, SkeletonCard } from '../components/ui/Primitives';
import ErrorState from '../components/ui/ErrorState';
import useRequest from '../components/ui/useRequest';
import { notify } from '../components/ui/notify';
import { formatDate } from '../components/ui/DatePicker';
import { automationsApi } from './api';

/**
 * Settings → Automations, for any module (server: routes/automations.ts; the recipes are defined with
 * `defineRecipe` in services/people/engagement/automations.ts). What CLOR sends on its own, as plain
 * sentences: a switch, at most one number, who it goes to and how, when it runs, when it last sent and to
 * whom, and its history. Not a workflow builder. A switch or a number saves at once; who and how are
 * changed in a small editor under the row. A list on the page ground under one hairline per group.
 *
 *   <AutomationsList module="payroll" openScreen={openScreen} readOnlyNote="Payroll admins change these." />
 */

const RECIPIENT_WORDS = { HR: 'HR', OWNER: 'Owner', MANAGER: 'Their manager' };
const CHANNEL_WORDS = { bell: 'In the app', app: 'Employee app', email: 'Email' };

const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/* Mid-sentence ("Goes to Owner and their manager"), so the manager is lower case. */
const toWords = (to) => (to || []).map((t) => (t.value.startsWith('PERSON:') ? t.label : t.value === 'MANAGER' ? 'their manager' : RECIPIENT_WORDS[t.value] || t.value));
/** "In the app and email". */
const channelWords = (channels) => andList((channels || []).map((c, i) => (i ? (CHANNEL_WORDS[c] || c).toLowerCase() : CHANNEL_WORDS[c] || c)));

/** The sentence with its number in place: "Remind managers of leave waiting [2] days". */
function Sentence({ a, editing, value, onValue, onCommit }) {
  const [before, after] = a.sentence.split('{n}');
  if (after === undefined) return <span>{a.sentence}</span>;
  return (
    <span>
      {before}
      {editing ? (
        <input type="number" inputMode="numeric" min={a.range.min} max={a.range.max} step={1} aria-label={`Days: ${a.sentence.replace('{n}', '…')}`}
          className="ui-input mx-1 inline-block w-16 text-center tabular-nums" value={value} onChange={(e) => onValue(e.target.value)} onBlur={onCommit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      ) : <strong className="tabular-nums">{a.n}</strong>}
      {after}
    </span>
  );
}

/** The on/off switch: a 24px track in a 44px button, so a thumb on a phone finds it. */
function Switch({ checked, disabled, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-lg disabled:opacity-50">
      <span aria-hidden="true" className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked ? 'bg-[rgb(var(--brand))]' : 'bg-[rgb(var(--border-strong))]'}`}>
        <span className={`inline-block h-5 w-5 rounded-full bg-[rgb(var(--surface))] transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}

function lastLine(a, canEdit) {
  if (a.managedIn || !canEdit) return null;
  if (!a.lastRun) return a.on ? 'Nothing sent yet' : null;
  const names = a.lastRun.recipients || [];
  const who = names.length ? `: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}` : '';
  return `Last sent ${formatDate(a.lastRun.on)}, ${a.lastRun.count}${who}`;
}

/** Who and how, changed together and saved with one button. At least one of each stays. */
function WhoAndHow({ a, users, busy, onSave, onClose }) {
  const [to, setTo] = useState(() => (a.to || []).map((t) => t.value));
  const [channels, setChannels] = useState(() => [...(a.channels || [])]);
  const [error, setError] = useState('');
  const flip = (list, set, v) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const options = a.recipients?.options || [];
  const named = to.filter((v) => v.startsWith('PERSON:'));
  const nameOf = (v) => users.find((u) => `PERSON:${u.id}` === v)?.name || (a.to || []).find((t) => t.value === v)?.label || 'Someone';
  const save = () => {
    if (a.recipients && !to.length) return setError('Choose at least one person to tell.');
    if (a.channelOptions && !channels.length) return setError('Keep at least one way to send it.');
    setError('');
    return onSave({ ...(a.recipients ? { to } : {}), ...(a.channelOptions ? { channels } : {}) });
  };
  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      {a.recipients ? (
        <fieldset>
          <legend className="ui-label">{a.recipients.label}</legend>
          <div className="flex flex-wrap gap-x-4">
            {options.filter((o) => o !== 'PERSON').map((o) => (
              <label key={o} className="flex min-h-[44px] items-center gap-2 text-sm sm:min-h-0 sm:py-1"><input type="checkbox" className="ui-checkbox" checked={to.includes(o)} onChange={() => flip(to, setTo, o)} />{RECIPIENT_WORDS[o] || o}</label>
            ))}
            {named.map((v) => (
              <label key={v} className="flex min-h-[44px] items-center gap-2 text-sm sm:min-h-0 sm:py-1"><input type="checkbox" className="ui-checkbox" checked onChange={() => flip(to, setTo, v)} />{nameOf(v)}</label>
            ))}
          </div>
          {options.includes('PERSON') && users.some((u) => !to.includes(`PERSON:${u.id}`)) ? (
            <select className="ui-select mt-2 w-full sm:w-64" aria-label="Add someone" value="" onChange={(e) => e.target.value && setTo([...to, e.target.value])}>
              <option value="">Add someone…</option>
              {users.filter((u) => !to.includes(`PERSON:${u.id}`)).map((u) => <option key={u.id} value={`PERSON:${u.id}`}>{u.name}</option>)}
            </select>
          ) : null}
        </fieldset>
      ) : null}
      {a.channelOptions ? (
        <fieldset>
          <legend className="ui-label">Send by</legend>
          <div className="flex flex-wrap gap-x-4">
            {a.channelOptions.map((c) => (
              <label key={c} className="flex min-h-[44px] items-center gap-2 text-sm sm:min-h-0 sm:py-1"><input type="checkbox" className="ui-checkbox" checked={channels.includes(c)} onChange={() => flip(channels, setChannels, c)} />{CHANNEL_WORDS[c] || c}</label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {error ? <p role="alert" className="ui-field-error">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={save}>Save</button>
        <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function History({ a, api }) {
  const req = useRequest(() => api.history(a.key), [a.key]);
  if (req.error) return <p className="ui-caption mt-2">History could not be read just now.</p>;
  if (!req.data) return <p className="ui-caption mt-2">Reading history…</p>;
  const rows = req.data.history || [];
  if (!rows.length) return <p className="ui-caption mt-2">Nothing sent yet.</p>;
  return (
    <ul className="mt-2 divide-y border-t" aria-label={`History: ${a.sentence.replace('{n}', String(a.n ?? ''))}`}>
      {rows.map((h) => (
        <li key={h.on} className="flex gap-3 py-2 text-sm">
          <span className="w-24 shrink-0 tabular-nums">{formatDate(h.on)}</span>
          <span className="w-8 shrink-0 text-right tabular-nums">{h.count}</span>
          <span className="min-w-0 flex-1 text-[rgb(var(--fg-muted))]">{(h.recipients || []).join(', ')}</span>
        </li>
      ))}
    </ul>
  );
}

function Row({ a, canEdit, busy, users, api, onSave, openScreen }) {
  const [n, setN] = useState(a.n == null ? '' : String(a.n));
  const [open, setOpen] = useState('');
  const editable = canEdit && !a.managedIn;
  const commit = () => {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v) || v === a.n) { setN(a.n == null ? '' : String(a.n)); return; }
    if (v < a.range.min || v > a.range.max) { notify.error(`Choose ${a.range.min} to ${a.range.max} days.`); setN(String(a.n)); return; }
    onSave(a.key, { n: v });
  };
  const who = a.to ? `${a.recipients?.label || 'Goes to'} ${andList(toWords(a.to))}` : null;
  const how = channelWords(a.channels);
  const choosable = editable && (a.recipients || a.channelOptions);
  const label = a.sentence.replace('{n}', String(a.n ?? ''));
  return (
    <li className="py-3">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm"><Sentence a={a} editing={editable && a.range} value={n} onValue={setN} onCommit={commit} /></p>
          <p className="ui-caption">
            {a.managedIn ? (
              <>{a.on ? 'On' : 'Off'}, set under {openScreen ? <button type="button" className="ui-link" onClick={() => openScreen(a.managedIn.screen)}>{a.managedIn.label}</button> : a.managedIn.label}</>
            ) : [a.when, a.on && a.nextRun && a.nextRun !== a.when ? `next: ${a.nextRun.toLowerCase()}` : null, lastLine(a, canEdit)].filter(Boolean).join(' · ')}
          </p>
          {!a.managedIn ? (
            /* Who and how, then the row's two small actions on the same line: one line per row, not three. */
            <div className="flex flex-wrap items-center gap-x-3">
              {who || how ? <p className="ui-caption">{[who, how].filter(Boolean).join(' · ')}</p> : null}
              {editable ? (
                <span className="flex gap-3">
                  {choosable ? <button type="button" className="ui-link text-xs" aria-expanded={open === 'edit'} aria-label={`Change who and how: ${label}`} onClick={() => setOpen(open === 'edit' ? '' : 'edit')}>Change</button> : null}
                  <button type="button" className="ui-link text-xs" aria-expanded={open === 'history'} aria-label={`History: ${label}`} onClick={() => setOpen(open === 'history' ? '' : 'history')}>History</button>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <Switch checked={a.on} disabled={!editable || busy} label={label} onChange={(on) => onSave(a.key, { on })} />
      </div>
      {open === 'edit' ? <WhoAndHow a={a} users={users} busy={busy} onClose={() => setOpen('')} onSave={async (patch) => { if (await onSave(a.key, patch)) setOpen(''); }} /> : null}
      {open === 'history' ? <History a={a} api={api} /> : null}
    </li>
  );
}

export default function AutomationsList({ module = 'people', title = 'Automations', openScreen, readOnlyNote = 'Only an admin changes these.', api: given }) {
  const api = useMemo(() => given || automationsApi(module), [given, module]);
  const req = useRequest(() => api.load(), [api]);
  const [busy, setBusy] = useState('');
  const shell = (body) => <div className="space-y-6 max-w-2xl"><PageHeader title={title} />{body}</div>;
  if (req.error && !req.data) return shell(<ErrorState error={req.error} onRetry={req.reload} />);
  if (!req.data) return shell(<SkeletonCard lines={10} />);
  const { automations, canEdit } = req.data;
  const users = req.data.users || [];
  const groups = [...new Set(automations.map((a) => a.group))];
  /** Saves one recipe's change; true when it went. */
  const save = async (key, patch) => {
    setBusy(key);
    try {
      const out = await api.save({ [key]: patch });
      if (req.setData) req.setData((d) => ({ ...d, automations: out.automations, users: out.users || d.users }));
      else req.reload();
      const a = out.automations.find((x) => x.key === key);
      notify.success(!a || patch.on === undefined ? 'Saved.' : `${a.on ? 'On' : 'Off'}: ${a.sentence.replace('{n}', String(a.n ?? ''))}.`);
      return true;
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
      return false;
    } finally {
      setBusy('');
    }
  };
  return shell(
    <>
      {!canEdit ? <p className="ui-caption">{readOnlyNote}</p> : null}
      {!automations.length ? <p className="ui-caption">Nothing runs on its own here yet.</p> : null}
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g} aria-labelledby={`auto-${module}-${g}`}>
            <h2 id={`auto-${module}-${g}`} className="ui-t-sec">{g}</h2>
            <ul className="divide-y border-t">
              {automations.filter((a) => a.group === g).map((a) => (
                <Row key={`${a.key}-${a.n}-${(a.to || []).map((t) => t.value).join()}-${(a.channels || []).join()}`} a={a} canEdit={canEdit} busy={busy === a.key} users={users} api={api} onSave={save} openScreen={openScreen} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>,
  );
}
