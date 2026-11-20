import React, { useCallback, useEffect, useState } from 'react';

import Modal from '@ui/components/ui/Modal';
import { apiFetch } from '@platform/http';

/**
 * Round 67 pick "whatsnew" (never Books): CLOR's release notes under Help,
 * What's new, with a dot while there is one this person has not read. Notes
 * are announcements of the kind "release" that CLOR staff write on
 * ops.clor.in; they never show as a banner. Opening the list marks every note
 * in it read, for this person on every device. Server: GET/POST
 * /announcements/whats-new(/seen).
 */
export function useWhatsNew(enabled = true) {
  const [data, setData] = useState({ notes: [], unseen: 0 });
  const load = useCallback(() => {
    if (!enabled) return;
    apiFetch('/announcements/whats-new')
      .then((r) => setData({ notes: r?.notes || [], unseen: r?.unseen || 0 }))
      .catch(() => setData({ notes: [], unseen: 0 }));
  }, [enabled]);
  useEffect(load, [load]);
  const markSeen = useCallback(() => {
    setData((d) => (d.unseen ? { notes: d.notes, unseen: 0 } : d));
    apiFetch('/announcements/whats-new/seen', { method: 'POST', body: {} }).catch(() => {});
  }, []);
  return { ...data, markSeen };
}

const onDay = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function WhatsNew({ notes, onClose }) {
  return (
    <Modal title="What’s new in CLOR" onClose={onClose} maxWidthClass="max-w-lg">
      {!notes.length ? (
        <p className="ws-card-blurb">Nothing new yet. Changes to CLOR are listed here as they arrive.</p>
      ) : (
        <ol className="r67-wn">
          {notes.map((n) => (
            <li key={n.id} className="r67-wn-item">
              <div className="r67-wn-top">
                <span>{n.title}</span>
                {!n.seen ? <span className="ws-pill ws-pill--info">New</span> : null}
              </div>
              <p className="text-sm">{n.body}</p>
              <p className="ws-item-sub">{onDay(n.on)}</p>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
