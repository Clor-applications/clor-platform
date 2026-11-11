import React, { useCallback, useEffect, useState } from 'react';
import { notify } from '@ui/components/ui/notify';

import { PageHead, WsDrawer } from '../../apps/admin/src/screens/wsKit';
import { AnnouncementNotice, KIND_WORD } from '../shell/Announcements';
import { APP_NAMES, Empty, Err, Loading, ReasonDrawer, Tabs, may, when } from './kit';
import { opsAnnouncementDelete, opsAnnouncementEnd, opsAnnouncementPublish, opsAnnouncementSave, opsAnnouncements } from './api';

/**
 * Announcements (operator console, Ops plan P1). Support writes a notice,
 * publishes it, and ends it; customers see it at the top of the app while it
 * lasts (packages/shell/Announcements.jsx). Every change asks for the
 * authenticator code and is audited under the operator's own name.
 */
const PILL = { info: 'ws-pill', maintenance: 'ws-pill ws-pill--warn', incident: 'ws-pill ws-pill--danger' };
const STATUS_WORD = { live: 'Showing now', scheduled: 'Starts later', draft: 'Draft', ended: 'Ended' };
const AUDIENCE_WORD = { everyone: 'everyone', admins: 'owners and administrators' };

const appsWords = (apps) => (apps?.length ? apps.map((a) => APP_NAMES[a] || a).join(', ') : 'every app');
/** "2026-11-11T09:30" in the browser's own time, for a datetime-local field. */
const localValue = (d) => {
  if (!d) return '';
  const t = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
};
const toIso = (v) => (v ? new Date(v).toISOString() : null);

function Field({ id, label, hint, children }) {
  return (
    <div className="grid gap-1 content-start">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <span className="ws-card-blurb">{hint}</span> : null}
    </div>
  );
}

function Editor({ editing, apps, onClose, onSaved }) {
  const [title, setTitle] = useState(editing?.title || '');
  const [body, setBody] = useState(editing?.body || '');
  const [kind, setKind] = useState(editing?.kind || 'info');
  const [chosen, setChosen] = useState(editing?.apps || []);
  const [audience, setAudience] = useState(editing?.audience || 'everyone');
  const [startsAt, setStartsAt] = useState(editing && editing.status !== 'live' ? localValue(editing.startsAt) : '');
  const [endsAt, setEndsAt] = useState(localValue(editing?.endsAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const live = editing?.status === 'live';
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = { title: title.trim(), body: body.trim(), kind, apps: chosen, audience, endsAt: toIso(endsAt) };
      /* A live one keeps the start it had; otherwise empty means "as soon as it is published". */
      if (!live) payload.startsAt = toIso(startsAt);
      const r = await opsAnnouncementSave(editing?.id, payload);
      onSaved(r.announcement, !editing);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (code) => setChosen((c) => (c.includes(code) ? c.filter((x) => x !== code) : [...c, code]));
  const ready = title.trim().length >= 4 && body.trim().length >= 10;
  return (
    <WsDrawer
      open
      onClose={onClose}
      title={editing ? 'Change the announcement' : 'New announcement'}
      description={live ? 'It is showing now: changes reach customers the next time their app looks, within ten minutes.' : 'Saved as a draft. Nobody sees it until you publish it.'}
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ws-btn ws-btn--primary" disabled={busy || !ready} onClick={save}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Save draft'}
          </button>
        </>
      }
    >
      <div className="grid gap-5">
        <Field id="ann-title" label="Title" hint="A few words, shown in bold.">
          <input id="ann-title" className="ui-input" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field id="ann-body" label="Message" hint={`What is happening, when, and what people should do. ${600 - body.length} characters left.`}>
          <textarea id="ann-body" className="ui-input" rows={3} maxLength={600} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Kind</legend>
          {['info', 'maintenance', 'incident'].map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="radio" name="ann-kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
              {KIND_WORD[k]}
              <span className="ws-item-sub">{k === 'incident' ? '· cannot be closed until you end it' : '· people can close it'}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Which customers</legend>
          <span className="ws-card-blurb">Tick none for every customer, or only the apps it is about.</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {apps.map((code) => (
              <label key={code} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={chosen.includes(code)} onChange={() => toggle(code)} />
                {APP_NAMES[code] || code}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Who in the account</legend>
          {['everyone', 'admins'].map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="radio" name="ann-audience" value={k} checked={audience === k} onChange={() => setAudience(k)} />
              {k === 'everyone' ? 'Everyone who signs in' : 'Owners and administrators only'}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          {live ? null : (
            <Field id="ann-start" label="Starts" hint="Leave empty to show it as soon as it is published.">
              <input id="ann-start" type="datetime-local" className="ui-input" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </Field>
          )}
          <Field id="ann-end" label="Ends" hint="Leave empty to keep it until you end it.">
            <input id="ann-end" type="datetime-local" className="ui-input" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </Field>
        </div>
        {title.trim() || body.trim() ? (
          <div className="grid gap-1">
            <span className="text-sm font-medium">What customers will see</span>
            <div style={{ border: '1px solid rgb(var(--ws-line))', borderRadius: 12, overflow: 'hidden' }}>
              <AnnouncementNotice a={{ id: 'preview', title: title.trim() || 'Title', body: body.trim(), kind, endsAt: toIso(endsAt), dismissible: kind !== 'incident' }} onClose={() => {}} />
            </div>
          </div>
        ) : null}
        <Err>{error}</Err>
      </div>
    </WsDrawer>
  );
}

const ASK = {
  publish: { title: 'Publish the announcement', confirm: 'Publish', tone: 'primary', what: (a) => (new Date(a.startsAt) > new Date() ? `It shows to ${AUDIENCE_WORD[a.audience]} using ${appsWords(a.apps)} from ${when(a.startsAt)}.` : `It shows now to ${AUDIENCE_WORD[a.audience]} using ${appsWords(a.apps)}, within ten minutes on screens already open.`) },
  end: { title: 'End the announcement', confirm: 'End now', tone: 'danger', what: () => 'It stops showing to everyone. It stays on record under Ended.' },
  delete: { title: 'Delete the draft', confirm: 'Delete draft', tone: 'danger', what: () => 'Nobody has seen it. It is removed for good.' },
};

export function Announcements({ me }) {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('live');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [asking, setAsking] = useState(null);
  const canWrite = may(me?.role, 'SUPPORT');
  const load = useCallback(() => {
    opsAnnouncements().then(setD).catch((e) => setError(String(e?.message || e)));
  }, []);
  useEffect(load, [load]);

  const act = async (reason) => {
    const { what, a } = asking;
    const call = { publish: opsAnnouncementPublish, end: opsAnnouncementEnd, delete: opsAnnouncementDelete }[what];
    await call(a.id, reason || undefined);
    notify.success(what === 'publish' ? 'Published.' : what === 'end' ? 'Ended. It no longer shows.' : 'Draft deleted.');
    setAsking(null);
    if (what === 'publish') setTab(new Date(a.startsAt) > new Date() ? 'scheduled' : 'live');
    if (what === 'end') setTab('ended');
    load();
  };

  const rows = d ? d.announcements.filter((a) => a.status === tab) : [];
  const c = d?.counts || {};
  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Product', 'Announcements']}
          title="Announcements"
          description="Notices from CLOR at the top of customers’ apps: news, planned maintenance, or a problem being fixed."
          meta={d ? `${c.live} showing now · ${c.scheduled} starting later · ${c.draft} ${c.draft === 1 ? 'draft' : 'drafts'}` : null}
          actions={
            canWrite ? (
              <button type="button" className="ws-btn ws-btn--primary" onClick={() => setEditing('new')}>
                New announcement
              </button>
            ) : null
          }
        />
        <Tabs
          label="Which announcements"
          value={tab}
          onChange={setTab}
          tabs={[
            ['live', `Showing now${d ? ` (${c.live})` : ''}`],
            ['scheduled', `Later${d && c.scheduled ? ` (${c.scheduled})` : ''}`],
            ['draft', `Drafts${d && c.draft ? ` (${c.draft})` : ''}`],
            ['ended', 'Ended'],
          ]}
        />
        <Err>{error}</Err>
        {!d && !error ? (
          <Loading />
        ) : d && rows.length === 0 ? (
          <Empty>{tab === 'live' ? 'Nothing is showing to customers.' : tab === 'scheduled' ? 'Nothing is waiting to start.' : tab === 'draft' ? 'No drafts.' : 'Nothing has ended yet.'}</Empty>
        ) : d ? (
          <ul className="ws-list ws-list--ground" aria-label="Announcements">
            {rows.map((a) => (
              <li key={a.id}>
                <div className="ws-item ws-item--wrap" style={{ alignItems: 'flex-start' }}>
                  <span className={PILL[a.kind]} style={{ flex: 'none', marginTop: 2 }}>
                    {KIND_WORD[a.kind]}
                  </span>
                  <span className="ws-item-text">
                    <span className="ws-item-title">{a.title}</span>
                    <span className="ws-item-sub" style={{ color: 'rgb(var(--ws-ink))' }}>{a.body}</span>
                    <span className="ws-item-sub">
                      {[
                        `For ${AUDIENCE_WORD[a.audience]} using ${appsWords(a.apps)}${a.apps?.length ? ' (shown in that app and the Workspace)' : ''}`,
                        a.status === 'ended' ? `ended ${when(a.endedAt || a.endsAt)}` : a.status === 'draft' ? null : `from ${when(a.startsAt)}`,
                        a.status !== 'ended' && a.endsAt ? `until ${when(a.endsAt)}` : null,
                        a.closedBy ? `closed by ${a.closedBy} ${a.closedBy === 1 ? 'person' : 'people'}` : null,
                        `by ${a.writtenBy}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {canWrite && a.status !== 'ended' ? (
                    <span className="ws-item-actions inline-flex flex-wrap gap-2">
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setEditing(a)}>
                        Change
                      </button>
                      {a.status === 'draft' ? (
                        <>
                          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setAsking({ what: 'publish', a })}>
                            Publish
                          </button>
                          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setAsking({ what: 'delete', a })}>
                            Delete
                          </button>
                        </>
                      ) : (
                        <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setAsking({ what: 'end', a })}>
                          End now
                        </button>
                      )}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {editing ? (
        <Editor
          editing={editing === 'new' ? null : editing}
          apps={d?.apps || []}
          onClose={() => setEditing(null)}
          onSaved={(a, created) => {
            setEditing(null);
            notify.success(created ? 'Saved as a draft. Publish it when it is ready.' : 'Saved.');
            setTab(a.status);
            load();
          }}
        />
      ) : null}
      {asking ? (
        <ReasonDrawer
          open
          reasonOptional
          title={ASK[asking.what].title}
          what={ASK[asking.what].what(asking.a)}
          confirmLabel={ASK[asking.what].confirm}
          tone={ASK[asking.what].tone}
          onClose={() => setAsking(null)}
          onConfirm={act}
        >
          <div style={{ border: '1px solid rgb(var(--ws-line))', borderRadius: 12, overflow: 'hidden' }}>
            <AnnouncementNotice a={{ ...asking.a, dismissible: asking.a.kind !== 'incident' }} onClose={asking.a.kind === 'incident' ? null : () => {}} />
          </div>
        </ReasonDrawer>
      ) : null}
    </div>
  );
}
