import React, { useRef, useState } from 'react';

import Drawer from '@ui/components/ui/Drawer';
import { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { notify } from '@ui/components/ui/notify';
import useRequest from '@ui/components/ui/useRequest';
import { Avatar, taskNote } from '@ui/personnel/Employees';

import { KIND_WORD, OWNER_WORD, orgUsers, updateTask, withOwner } from './api';

export { can } from '@ui/permissions/can';
export const crumbs = () => [{ label: 'People' }, { label: 'Joining & leaving' }];

/** A person in a list row: avatar, name, then the line under it. */
export function PersonCell({ person, line }) {
  return (
    <span className="flex items-center gap-2.5 min-w-0">
      <Avatar person={{ name: person.name, photoUrl: person.photoUrl }} size={32} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{person.name}</span>
        <span className="block truncate ui-caption">{line ?? [person.code, person.designation].filter(Boolean).join(' · ')}</span>
      </span>
    </span>
  );
}

/** "3 of 8" with a thin bar, and how many are late. */
export function Progress({ done, total, late }) {
  if (!total) return <span className="ui-caption">No plan</span>;
  return (
    <span className="inline-flex min-w-[7rem] flex-col gap-1">
      <span className="tabular-nums text-sm">{done} of {total}{late ? <span className="ui-text-neg font-medium"> · {late} late</span> : null}</span>
      <span className="ui-meter" data-tone="progress" aria-hidden="true"><span style={{ width: `${Math.round((done / total) * 100)}%` }} /></span>
    </span>
  );
}

/** The next open task: what, whose, when. */
export function NextTask({ next }) {
  if (!next) return <span className="ui-caption">Nothing open</span>;
  return (
    <span className="block min-w-0">
      <span className="block truncate">{next.title}</span>
      <span className={`block ui-caption ${next.late ? 'ui-text-neg' : ''}`}>{next.ownerName || next.ownerWord}{next.dueDate ? ` · ${next.late ? 'was due' : 'due'} ${formatDate(next.dueDate)}` : ''}</span>
    </span>
  );
}

/** Where CLOR's own reader removal stands, in words. */
export function readerWords(task) {
  if (task.system !== 'READERS') return null;
  return { WAITING: 'Waiting for every reader to confirm', FAILED: 'Not confirmed: remove them at the reader by hand, then close this with a note', CONFIRMED: 'Every reader confirmed', MANUAL: 'Removed at the reader by hand', NONE: 'No reader held them' }[task.systemState] || 'CLOR takes them off the readers on the last day';
}

/**
 * One task: what it is, whose, when, and closing it. A step that needs a
 * note asks for one; CLOR's own reader removal cannot be ticked until it
 * failed; someone's own plan is closed by someone else. HR may hand it on.
 */
export function TaskDrawer({ task, canAssign, onClose, onSaved }) {
  const [note, setNote] = useState('');
  const [owner, setOwner] = useState(task.ownerUserId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const users = useRequest(() => (canAssign ? orgUsers() : Promise.resolve([])), [canAssign]);
  const waiting = task.system === 'READERS' && task.systemState !== 'FAILED';
  const noteNeeded = task.needsNote || task.systemState === 'FAILED';
  /* `canClose` comes with queue rows; a plan's own list leaves it to the server, which says why it refuses. */
  const closable = !task.done && !waiting && !task.ownPlan && task.canClose !== false;
  const noteRef = useRef(null);
  /* Handing a task on and closing it are two things: a new owner set here hands it on and leaves it open. */
  const handing = canAssign && owner !== (task.ownerUserId || '');
  const dirty = Boolean(note.trim()) || handing;
  const save = async (e) => {
    e?.preventDefault();
    if (!handing && closable && noteNeeded && !note.trim()) { setError(task.systemState === 'FAILED' ? 'Say how it was done.' : 'Add a note, for example the payment reference.'); noteRef.current?.focus(); return; }
    setBusy(true);
    setError('');
    try {
      const body = handing ? { ownerUserId: owner || null, ...(note.trim() ? { note: note.trim() } : {}) } : { done: true, note: note.trim() || undefined };
      await updateTask(task.id, body);
      notify.success(body.done ? 'Done.' : 'Handed on.');
      onSaved?.();
    } catch (err) {
      setError(String(err?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  const userOptions = [{ value: '', label: 'Nobody yet' }, ...withOwner(users.data || [], task.ownerUserId, task.ownerName).map((u) => ({ value: u.id, label: u.fullName || u.name || u.email }))];
  const primary = handing ? 'Hand on' : 'Mark done';
  return (
    <Drawer open onClose={onClose} dirty={dirty} widthClass="w-[min(34rem,96vw)]" title={task.title} description={`${KIND_WORD[task.kind] || task.kind} · ${task.employee?.name || ''}`}
      footer={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        {closable || handing ? <button type="submit" form="task-form" className="ui-btn ui-btn-primary" disabled={busy}>{busy ? 'Saving…' : primary}</button> : null}
      </>}>
      <form id="task-form" onSubmit={save} className="grid gap-4">
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <div><dt className="ui-label">Owner</dt><dd className="mt-0.5">{task.ownerName ? `${task.ownerName} (${OWNER_WORD[task.owner] || task.owner})` : `${OWNER_WORD[task.owner] || task.owner}, nobody named`}</dd></div>
          <div><dt className="ui-label">Due</dt><dd className={`mt-0.5 tabular-nums ${task.late ? 'ui-text-neg font-medium' : ''}`}>{task.dueDate ? formatDate(task.dueDate) : 'No date'}{task.workingDays ? ' (working days)' : ''}{task.late ? ', late' : ''}</dd></div>
          {task.done ? <div><dt className="ui-label">Done</dt><dd className="mt-0.5">{task.doneAt ? formatDate(String(task.doneAt).slice(0, 10)) : ''}{task.doneBy ? ` by ${task.doneBy}` : ''}</dd></div> : null}
        </dl>
        {/* A failed removal's note names the reader and what to do; the general words would only repeat it. */}
        {readerWords(task) && task.systemState !== 'FAILED' ? <p className="text-sm">{readerWords(task)}.</p> : null}
        {taskNote(task.note) ? <p className={`text-sm whitespace-pre-line ${task.systemState === 'FAILED' && !task.done ? 'ui-text-neg' : 'ui-muted'}`}>{taskNote(task.note)}</p> : null}
        {task.ownPlan ? <p className="text-sm">This task is on your own plan: someone else closes it.</p> : !task.done && task.canClose === false ? <p className="text-sm">{task.ownerName || 'Its owner'} closes this one.</p> : null}
        {closable ? (
          <label className="block">
            <span className="ui-label">{noteNeeded && !handing ? 'Note *' : 'Note (optional)'}</span>
            <textarea ref={noteRef} className="ui-input w-full" rows={2} maxLength={500} value={note} onChange={(e) => { setNote(e.target.value); setError(''); }} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? 'task-note-error' : undefined}
              placeholder={task.needsNote ? 'Payment reference, asset tag, or what was done' : ''} />
            {error ? <span id="task-note-error" className="ui-field-error" role="alert">{error}</span> : null}
          </label>
        ) : error ? <p className="ui-field-error" role="alert">{error}</p> : null}
        {canAssign && !task.done && !task.ownPlan ? (
          <div><PopupSelect label="Whose task" showValueSubtext={false} value={owner} onChange={(v) => setOwner(v || '')} options={userOptions} /></div>
        ) : null}
      </form>
    </Drawer>
  );
}
