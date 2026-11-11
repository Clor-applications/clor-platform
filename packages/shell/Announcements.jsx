import React, { useCallback, useEffect, useState } from 'react';
import { X } from '@ui/components/ui/lineIcons';
import { apiFetch } from '@platform/http';

/**
 * Announcements from CLOR at the top of the app (Ops plan P1; server:
 * routes/announcements.ts). A problem being fixed comes first and stays until
 * CLOR ends it; planned maintenance and news can be closed, and stay closed
 * for that person on every device. Looked up on opening and every ten minutes.
 */
export const KIND_WORD = { info: 'News', maintenance: 'Planned maintenance', incident: 'Problem we are fixing' };
const KIND_STYLE = {
  info: { backgroundColor: 'rgb(var(--info-soft))' },
  maintenance: { backgroundColor: 'rgb(var(--warn-soft))', color: 'rgb(var(--warn-ink))' },
  incident: { backgroundColor: 'rgb(var(--neg-soft))' },
};
const EVERY = 10 * 60 * 1000;
/** More than this many at once fold behind "n more". */
const SHOW = 2;

const until = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** One notice. Used by the app bar and by the console's preview, so staff see exactly what customers will. */
export function AnnouncementNotice({ a, onClose, busy = false }) {
  return (
    <div
      role={a.kind === 'incident' ? 'alert' : 'status'}
      className="flex flex-wrap items-start gap-x-3 gap-y-1 px-6 py-2 text-sm"
      style={{ ...KIND_STYLE[a.kind], borderBottom: '1px solid rgb(var(--border))' }}
    >
      <span className="min-w-0 flex-1">
        <strong className="font-semibold">{a.title}</strong>
        <span className="sr-only"> ({KIND_WORD[a.kind] || 'News'})</span>
        {' '}
        {a.body}
        {a.endsAt ? <span style={{ opacity: 0.8 }}> Until {until(a.endsAt)}.</span> : null}
      </span>
      {onClose && a.dismissible !== false ? (
        <button type="button" className="ui-icon-btn" style={{ marginBlock: -4 }} onClick={onClose} disabled={busy} aria-label={`Close: ${a.title}`} title="Close">
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * `app` is the app on screen: a notice about one app shows in that app and in
 * the Workspace, not in the customer's other apps.
 */
export function AnnouncementBar({ app = null }) {
  const [list, setList] = useState([]);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    /* A notice that cannot load must never get in the way of work. */
    apiFetch('/announcements')
      .then((r) => setList(r?.announcements || []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, EVERY);
    return () => clearInterval(t);
  }, [load]);
  const close = async (a) => {
    setBusy(a.id);
    try {
      await apiFetch(`/announcements/${encodeURIComponent(a.id)}/dismiss`, { method: 'POST', body: {} });
    } catch {
      /* Closed here either way; it may come back on the next look. */
    }
    setList((l) => l.filter((x) => x.id !== a.id));
    setBusy('');
  };
  const here = list.filter((a) => !a.apps?.length || !app || app === 'admin' || a.apps.includes(app));
  if (!here.length) return null;
  const shown = all ? here : here.slice(0, SHOW);
  return (
    <div aria-label="Announcements from CLOR">
      {shown.map((a) => (
        <AnnouncementNotice key={a.id} a={a} busy={busy === a.id} onClose={() => close(a)} />
      ))}
      {here.length > SHOW ? (
        <div className="px-6 py-1 text-sm" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
          <button type="button" className="ui-link" onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? 'Show fewer' : `${here.length - SHOW} more from CLOR`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
