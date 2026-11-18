import React, { useEffect, useState } from 'react';
import { Pin } from 'lucide-react';

import { opsNotes } from './api';
import { when } from './kit';

/**
 * Round 35 picks (owner, 18 Nov 2026).
 *
 * custnotes A: a pinned note sits at the top of the customer page, above the
 * tabs, so whoever opens the account reads it before doing anything. The
 * notes themselves live on the Notes tab (server: routes/opsNotes.ts); this
 * only reads them. Nothing shows while loading, on an error, or with no
 * pinned note: the page must never wait on its notes.
 *
 * callerverify C: no change to an account is made over the phone. The owner
 * does it signed in, or opens a ticket from Workspace → Support.
 */
export function PinnedNotes({ id, onOpen }) {
  const [got, setGot] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => opsNotes(id))
      .then((r) => live && setGot({ forId: id, rows: (r?.notes || []).filter((n) => n.pinned) }))
      .catch(() => live && setGot({ forId: id, rows: [] }));
    return () => {
      live = false;
    };
  }, [id]);
  /* Another account's notes never show while this one's are on their way. */
  const rows = got?.forId === id ? got.rows : [];
  if (!rows.length) return null;
  return (
    <section className="ops-pinned" aria-label="Pinned notes">
      <ul>
        {rows.map((n) => (
          <li key={n.id}>
            <Pin size={14} aria-hidden="true" className="ops-pinned-ico" />
            <span className="ops-pinned-text">
              <span className="ops-pinned-body">{n.body}</span>
              <span className="ops-pinned-by">
                {n.author}
                {n.createdAt ? ` · ${when(n.createdAt)}` : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {onOpen ? (
        <button type="button" className="ws-link ops-pinned-all" onClick={onOpen}>
          All notes
        </button>
      ) : null}
    </section>
  );
}

export function PhoneRule() {
  return (
    <p className="ws-notice" role="note">
      Asked on a call to change something? CLOR staff do not change an account over the phone. Ask the owner to make the change signed in, or to open a ticket from Workspace, Support.
    </p>
  );
}
