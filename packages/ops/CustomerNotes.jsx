import React, { useCallback, useEffect, useState } from 'react';
import { notify } from '@ui/components/ui/notify';
import { Panel } from '../../apps/admin/src/screens/wsKit';
import { opsAddNote, opsAddTag, opsChangeNote, opsNotes, opsRemoveNote, opsRemoveTag, opsTags } from './api';
import { Empty, Err, Loading, may, when } from './kit';

/**
 * Customer page → Notes (server: routes/opsNotes.ts). CLOR staff's own
 * memory of a customer, never shown to them: tags to find a group again, and
 * notes such as "called the owner, e-invoice password was wrong". Pinned notes
 * stay on top. A note is changed only by whoever wrote it, or the owner.
 */
export function CustomerNotes({ id, role }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [known, setKnown] = useState([]);
  const [tag, setTag] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const canWrite = may(role, 'SALES', 'SUPPORT', 'BILLING');

  const load = useCallback(() => {
    opsNotes(id)
      .then((r) => (setD(r), setError('')))
      .catch((e) => setError(String(e?.message || e)));
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    opsTags().then((r) => setKnown((r.tags || []).map((t) => t.tag))).catch(() => setKnown([]));
  }, []);

  const run = async (fn, said) => {
    setBusy(true);
    try {
      await fn();
      if (said) notify.success(said);
      load();
      return true;
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addTag = async (e) => {
    e.preventDefault();
    if (await run(() => opsAddTag(id, tag.trim()), null)) setTag('');
  };
  const addNote = async (e) => {
    e.preventDefault();
    if (await run(() => opsAddNote(id, { body: body.trim(), pinned }), 'Note saved. Only CLOR staff see it.')) {
      setBody('');
      setPinned(false);
    }
  };

  if (!d) return error ? <Err>{error}</Err> : <Loading />;
  const unused = known.filter((t) => !d.tags.includes(t));
  return (
    <>
      <Panel title="Tags">
        <div className="grid gap-3">
          {d.tags.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Tags on this customer">
              {d.tags.map((t) => (
                <li key={t} className="ws-pill inline-flex items-center gap-1">
                  {t}
                  {canWrite ? (
                    <button type="button" className="ws-link" aria-label={`Take off ${t}`} disabled={busy} onClick={() => run(() => opsRemoveTag(id, t), null)}>
                      ×
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ws-card-blurb">No tags. A tag such as “CA firm” or “pilot” lets you find this group again on the customers list.</p>
          )}
          {canWrite ? (
            <form onSubmit={addTag} className="flex flex-wrap gap-2 items-end">
              <label className="block">
                <span className="ui-label">Add a tag</span>
                <input className="ui-input" list="ops-known-tags" maxLength={30} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. pilot" />
                <datalist id="ops-known-tags">
                  {unused.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </label>
              <button type="submit" className="ws-btn ws-btn--quiet" disabled={busy || tag.trim().length < 2}>
                Add tag
              </button>
            </form>
          ) : null}
        </div>
      </Panel>

      <Panel title="Notes">
        <div className="grid gap-4">
          {canWrite ? (
            <form onSubmit={addNote} className="grid gap-2" style={{ maxWidth: '40rem' }}>
              <label className="block">
                <span className="ui-label">New note</span>
                <textarea className="ui-input w-full" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Called the owner on 12 Nov: the e-invoice password was wrong." />
              </label>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin it on top
                </label>
                <button type="submit" className="ws-btn ws-btn--primary" disabled={busy || body.trim().length < 2}>
                  Save note
                </button>
              </div>
            </form>
          ) : null}
          {!d.notes.length ? (
            <Empty>No notes yet. What you write here is for CLOR staff only.</Empty>
          ) : (
            <ul className="ws-list">
              {d.notes.map((n) => (
                <li key={n.id}>
                  <div className="ws-item">
                    <span className="ws-item-text">
                      <span className="ws-item-title">
                        {n.pinned ? <span className="ws-pill ws-pill--neutral mr-2">Pinned</span> : null}
                        {n.author}
                        {n.mine ? ' (you)' : ''}
                      </span>
                      <span className="ws-item-sub" style={{ whiteSpace: 'pre-wrap' }}>{n.body}</span>
                      <span className="ws-item-sub">{when(n.createdAt)}{n.updatedAt && new Date(n.updatedAt) - new Date(n.createdAt) > 60_000 ? ' · changed' : ''}</span>
                    </span>
                    {n.mayChange && canWrite ? (
                      <span className="inline-flex gap-1">
                        <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={busy} onClick={() => run(() => opsChangeNote(id, n.id, { pinned: !n.pinned }), n.pinned ? 'Unpinned.' : 'Pinned.')}>
                          {n.pinned ? 'Unpin' : 'Pin'}
                        </button>
                        <button type="button" className="ws-btn ws-btn--danger-quiet ws-btn--small" disabled={busy} onClick={() => run(() => opsRemoveNote(id, n.id), 'Note removed.')}>
                          Remove
                        </button>
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
      <Err>{error}</Err>
    </>
  );
}
