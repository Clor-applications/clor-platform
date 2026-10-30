import React, { useState } from 'react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { formatDate } from '@ui/components/ui/DatePicker';

import Toggle from '../components/Toggle';
import { getAutomations, saveAutomations } from '../api/engagement';

/**
 * Settings → Automations (WORKFLOW-GAP-RESEARCH-2026-10-30 4.7): what CLOR sends on its own, as plain
 * sentences with a switch and at most one number. Not a workflow builder. What already ran before this
 * screen starts on; everything new starts off. Two attendance reminders have their own settings and link
 * there. Each shows when it runs, when it last sent, how many and to whom. A change saves at once.
 */

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

function lastLine(a, canEdit) {
  if (a.managedIn) return null;
  /* Who it last told is HR's to read: the server sends it to nobody else, and that is not "nothing sent". */
  if (!canEdit) return null;
  if (!a.lastRun) return a.on ? 'Nothing sent yet' : null;
  const names = a.lastRun.recipients || [];
  const who = names.length ? `: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}` : '';
  return `Last sent ${formatDate(a.lastRun.on)}, ${a.lastRun.count}${who}`;
}

function Row({ a, canEdit, busy, onSave, openScreen }) {
  const [n, setN] = useState(a.n == null ? '' : String(a.n));
  const editable = canEdit && !a.managedIn;
  const commit = () => {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v) || v === a.n) { setN(a.n == null ? '' : String(a.n)); return; }
    if (v < a.range.min || v > a.range.max) { notify.error(`Choose ${a.range.min} to ${a.range.max} days.`); setN(String(a.n)); return; }
    onSave(a.key, { n: v });
  };
  const last = lastLine(a, canEdit);
  return (
    <li className="flex items-start gap-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm"><Sentence a={a} editing={editable && a.range} value={n} onValue={setN} onCommit={commit} /></p>
        <p className="ui-caption">
          {a.managedIn ? (
            <>{a.on ? 'On' : 'Off'}, set under {openScreen ? <button type="button" className="ui-link" onClick={() => openScreen(a.managedIn.screen)}>{a.managedIn.label}</button> : a.managedIn.label}</>
          ) : [a.when, a.on && a.nextRun && a.nextRun !== a.when ? `next: ${a.nextRun.toLowerCase()}` : null, last].filter(Boolean).join(' · ')}
        </p>
      </div>
      <Toggle checked={a.on} disabled={!editable || busy} label={a.sentence.replace('{n}', String(a.n ?? ''))} onChange={(on) => onSave(a.key, { on })} />
    </li>
  );
}

export default function Automations({ openScreen }) {
  const req = useRequest(() => getAutomations(), []);
  const [busy, setBusy] = useState('');
  const title = 'Automations';
  if (req.error && !req.data) return <div className="space-y-6 max-w-3xl"><PageHeader title={title} /><ErrorState error={req.error} onRetry={req.reload} /></div>;
  if (!req.data) return <div className="space-y-6 max-w-3xl"><PageHeader title={title} /><SkeletonCard lines={10} /></div>;
  const { automations, canEdit } = req.data;
  const groups = [...new Set(automations.map((a) => a.group))];
  const save = async (key, patch) => {
    setBusy(key);
    try {
      const out = await saveAutomations({ [key]: patch });
      req.setData?.((d) => ({ ...d, automations: out.automations }));
      if (!req.setData) req.reload();
      const a = out.automations.find((x) => x.key === key);
      notify.success(patch.on === undefined ? 'Saved.' : `${a.on ? 'On' : 'Off'}: ${a.sentence.replace('{n}', String(a.n ?? ''))}.`);
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader title={title} />
      {!canEdit ? <p className="ui-caption">HR changes these.</p> : null}
      <div className="ui-record-section space-y-6">
        {groups.map((g) => (
          <section key={g} aria-labelledby={`auto-${g}`}>
            <h2 id={`auto-${g}`} className="ui-t-sec">{g}</h2>
            <ul className="divide-y">
              {automations.filter((a) => a.group === g).map((a) => <Row key={`${a.key}-${a.n}`} a={a} canEdit={canEdit} busy={busy === a.key} onSave={save} openScreen={openScreen} />)}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
