import React, { useCallback, useEffect, useState } from 'react';
import { notify } from '@ui/components/ui/notify';
import { PageHead, Panel, WsDrawer } from '../../apps/admin/src/screens/wsKit';
import { opsRemoveSavedReply, opsSaveSavedReply, opsSavedReplies } from './api';
import { APP_NAMES, Empty, Err, Loading, may } from './kit';

/**
 * Saved replies (server: routes/opsSavedReplies.ts): the answers Support gives
 * again and again, written once and picked in a ticket's reply box. {name}
 * becomes the customer's first name, {ticket} the ticket's code.
 */
const APPS = ['accounting', 'people', 'attendance', 'payroll', 'workspace'];
const appWord = (a) => (a === 'workspace' ? 'Workspace' : APP_NAMES[a] || a);

function Editor({ reply, onClose, onSaved }) {
  const [title, setTitle] = useState(reply?.title || '');
  const [body, setBody] = useState(reply?.body || '');
  const [app, setApp] = useState(reply?.app || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await opsSaveSavedReply(reply?.id, { title: title.trim(), body: body.trim(), app: app || null });
      onSaved();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <WsDrawer
      open
      onClose={onClose}
      title={reply ? 'Change the saved reply' : 'New saved reply'}
      description="Write {name} for the customer’s first name and {ticket} for the ticket’s code."
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="button" className="ws-btn ws-btn--primary" disabled={busy || title.trim().length < 3 || body.trim().length < 10} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="grid gap-5">
        <label className="grid gap-1">
          <span className="ui-label">Title</span>
          <input className="ui-input" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Forgot password" />
        </label>
        <label className="grid gap-1">
          <span className="ui-label">Reply</span>
          <textarea className="ui-input" rows={8} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={'Hi {name},\n\nUse Forgot password on the sign-in page…'} />
        </label>
        <label className="grid gap-1">
          <span className="ui-label">App</span>
          <select className="ui-select" value={app} onChange={(e) => setApp(e.target.value)}>
            <option value="">Any app</option>
            {APPS.map((a) => (
              <option key={a} value={a}>{appWord(a)}</option>
            ))}
          </select>
          <span className="ui-caption">Replies for a ticket’s own app are offered first.</span>
        </label>
        <Err>{error}</Err>
      </div>
    </WsDrawer>
  );
}

export function SavedReplies({ me }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const canWrite = may(me?.role, 'SUPPORT');
  const load = useCallback(() => {
    opsSavedReplies().then((r) => (setRows(r.replies), setError(''))).catch((e) => setError(String(e?.message || e)));
  }, []);
  useEffect(load, [load]);
  const remove = async (r) => {
    if (!window.confirm(`Remove the saved reply “${r.title}”?`)) return;
    try {
      await opsRemoveSavedReply(r.id);
      notify.success('Removed.');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not removed.'));
    }
  };
  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Customers', 'Saved replies']}
          title="Saved replies"
          description="Answers Support gives often, picked in a ticket’s reply box and changed there before sending."
          actions={canWrite ? <button type="button" className="ws-btn ws-btn--primary" onClick={() => setEditing('new')}>New saved reply</button> : null}
        />
        <Err>{error}</Err>
        {!rows ? (
          error ? null : <Loading />
        ) : !rows.length ? (
          <Empty>No saved replies yet.</Empty>
        ) : (
          <Panel title={`${rows.length} ${rows.length === 1 ? 'reply' : 'replies'}, most used first`}>
            <ul className="ws-list">
              {rows.map((r) => (
                <li key={r.id}>
                  <div className="ws-item ws-item--wrap">
                    <span className="ws-item-text">
                      <span className="ws-item-title">
                        {r.title} {r.app ? <span className="ws-pill">{appWord(r.app)}</span> : null}
                      </span>
                      <span className="ws-item-sub" style={{ whiteSpace: 'pre-wrap' }}>{r.body.length > 220 ? `${r.body.slice(0, 220)}…` : r.body}</span>
                      <span className="ws-item-sub tabular-nums">Used {r.usedCount} {r.usedCount === 1 ? 'time' : 'times'}</span>
                    </span>
                    {canWrite ? (
                      <span className="inline-flex gap-1">
                        <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setEditing(r)}>Change</button>
                        <button type="button" className="ws-btn ws-btn--danger-quiet ws-btn--small" onClick={() => remove(r)}>Remove</button>
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {editing ? (
          <Editor
            reply={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              notify.success('Saved.');
              load();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/** The picker in a ticket's reply box: fills the reply with the chosen one, already addressed to the customer. */
export function SavedReplyPicker({ ticketId, onPick }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    opsSavedReplies(ticketId).then((r) => setRows(r.replies || [])).catch(() => setRows([]));
  }, [ticketId]);
  if (!rows?.length) return null;
  return (
    <label className="grid">
      <span>Start from a saved reply</span>
      <select
        className="ui-select"
        value=""
        onChange={(e) => {
          const r = rows.find((x) => x.id === e.target.value);
          if (r) onPick(r);
        }}
      >
        <option value="">Pick one…</option>
        {rows.map((r) => (
          <option key={r.id} value={r.id}>{r.title}</option>
        ))}
      </select>
    </label>
  );
}
