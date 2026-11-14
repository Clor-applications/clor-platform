import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from '@ui/components/ui/lineIcons';

import ShownOnce from '@ui/components/ui/ShownOnce';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { requestOpenApp } from '@platform/context';
import {
  createApiKey,
  extendCredential,
  listCredentials,
  markCredentialReviewed,
  resumeCredential,
  revokeCredential,
  rotateCredential,
  suspendCredential,
} from '@platform/admin/credentials';
import { KIND, STATUS, actionsFor } from './credentialsModel';
import { ICON, PageHead, Stat, WsDrawer } from './wsKit';
import './workspace.css';

/**
 * Workspace → Security → Credentials (Batch 5; redesign W-R7).
 *
 * Every key and token this company has given to another system — API keys,
 * on-site connectors, reader push addresses, directory sync — in one list,
 * with what each can do right now and, when it cannot, why. API keys are made
 * here; connectors and readers are set up on their Attendance screens and
 * rotated there, where the new token is installed. Customer links are
 * counted, not listed.
 */

const SCOPE_LABEL = {
  'attendance:read': 'Read attendance',
  'employees:read': 'Read employees',
  'employees:write': 'Add and change employees',
  'punches:write': 'Send punches',
  'leave:read': 'Read leave',
  'leave:write': 'Ask for leave',
  'leave:approve': 'Approve leave',
  'readers:read': 'Read readers',
};

const REASONS = ['Routine change', 'It may have leaked', 'No longer used', 'The person who set it up left', 'Other'];
const DAY = 86_400_000;
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();
const dateOf = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—');
const agoOf = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not used yet');

/* The model's pill tones, in the Workspace's pills. */
const TONE = { 'ui-pill-pos': 'ws-pill ws-pill--ok', 'ui-pill-neutral': 'ws-pill ws-pill--neutral', 'ui-pill-warn': 'ws-pill ws-pill--warn' };
/* The drawers are portalled out of the page: `.ws` brings the tokens without the page padding and ground. */
const DRAWER_WS = { padding: 0, background: 'none', minHeight: 0 };

const ACTION_LABEL = { review: 'Mark reviewed', resume: 'Resume', suspend: 'Pause', extend: 'Extend', rotate: 'Rotate', revoke: 'Revoke' };

function NewKey({ scopes, onDone, onClose }) {
  const [form, setForm] = useState({ name: '', scopes: ['attendance:read'], allowedIps: '', expiry: '365' });
  const [busy, setBusy] = useState(false);
  const toggle = (k) => setForm((f) => ({ ...f, scopes: f.scopes.includes(k) ? f.scopes.filter((x) => x !== k) : [...f.scopes, k] }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await createApiKey({ name: form.name, scopes: form.scopes, allowedIps: form.allowedIps || null, expiresAt: form.expiry === 'none' ? null : inDays(Number(form.expiry)) });
      onDone({ label: `API key “${form.name}”`, value: r.token });
    } catch (err) {
      notify.error(String(err?.message || 'Not made.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <WsDrawer open onClose={onClose} title="New API key" description="Shown once, when made.">
      <div className="ws" style={DRAWER_WS}>
        <form onSubmit={submit} className="grid gap-4">
          <label className="grid gap-1"><span className="text-sm font-medium">Name *</span><input className="ui-input w-full" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="What uses it, e.g. greytHR sync" /></label>
          <fieldset className="grid gap-1">
            <legend className="text-sm font-medium mb-1">It may</legend>
            {(scopes || Object.keys(SCOPE_LABEL)).map((k) => (
              <label key={k} className="flex items-center gap-2 py-0.5 text-sm">
                <input type="checkbox" className="ui-checkbox" checked={form.scopes.includes(k)} onChange={() => toggle(k)} /> {SCOPE_LABEL[k] || k}
              </label>
            ))}
          </fieldset>
          <label className="grid gap-1"><span className="text-sm font-medium">Only from these addresses</span><input className="ui-input w-full" value={form.allowedIps} onChange={(e) => setForm({ ...form, allowedIps: e.target.value })} placeholder="Blank = anywhere; e.g. 203.0.113.10" /></label>
          <label className="grid gap-1"><span className="text-sm font-medium">Expires</span>
            <select className="ui-select" value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })}>
              <option value="365">In a year</option>
              <option value="180">In 6 months</option>
              <option value="90">In 3 months</option>
              <option value="none">Never</option>
            </select>
          </label>
          <p className="ui-caption">You can extend it later.</p>
          <div className="flex gap-2">
            <button type="submit" className="ws-btn ws-btn--primary" disabled={busy || !form.scopes.length}>{busy ? 'Making…' : 'Make the key'}</button>
            <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </WsDrawer>
  );
}

/** Asks why (recorded with the change) and, for an extension, until when. */
function Change({ action, credential, onDone, onClose }) {
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [months, setMonths] = useState('12');
  const [busy, setBusy] = useState(false);
  const words = {
    suspend: credential.kind === 'SCIM'
      ? 'It stops at once. You can resume it.'
      : 'It stops at once and can be resumed.',
    rotate: credential.kind === 'SCIM' ? 'The current token stops at once.' : 'The current key stops at once.',
    revoke: 'It stops for good. Make a new one if it is needed again.',
    extend: 'Up to a year from today.',
  }[action];
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const why = note ? `${reason}: ${note}` : reason;
    try {
      if (action === 'suspend') await suspendCredential(credential.id, why);
      if (action === 'revoke') await revokeCredential(credential.id, why);
      if (action === 'extend') await extendCredential(credential.id, inDays(Math.min(365, Number(months) * 30.4)));
      if (action === 'rotate') {
        const r = await rotateCredential(credential.id, why);
        onDone(r.token ? { label: `New ${KIND[credential.kind].toLowerCase()}`, value: r.token, hint: r.note } : null, r.note);
        return;
      }
      onDone(null, { suspend: 'Paused.', revoke: 'Revoked.', extend: 'Extended.' }[action]);
    } catch (err) {
      notify.error(String(err?.message || 'Not done.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <WsDrawer open onClose={onClose} title={`${ACTION_LABEL[action]} ${KIND[credential.kind].toLowerCase()} ${credential.tokenPrefix}…`} description={credential.label || credential.owner?.name || ''}>
      <div className="ws" style={DRAWER_WS}>
        <form onSubmit={submit} className="grid gap-4">
          <p className="text-sm">{words}</p>
          {action === 'extend' ? (
            <label className="grid gap-1"><span className="text-sm font-medium">Keep it working for</span>
              <select className="ui-select" value={months} onChange={(e) => setMonths(e.target.value)}>
                <option value="3">3 more months from today</option>
                <option value="6">6 more months from today</option>
                <option value="12">A year from today</option>
              </select>
            </label>
          ) : (
            <>
              <label className="grid gap-1"><span className="text-sm font-medium">Why</span>
                <select className="ui-select" value={reason} onChange={(e) => setReason(e.target.value)}>
                  {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="grid gap-1"><span className="text-sm font-medium">Note</span><input className="ui-input w-full" maxLength={150} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — kept in the history" /></label>
            </>
          )}
          <div className="flex gap-2">
            <button type="submit" className={`ws-btn ${action === 'revoke' ? 'ws-btn--danger' : 'ws-btn--primary'}`} disabled={busy}>{busy ? 'Working…' : ACTION_LABEL[action]}</button>
            <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </WsDrawer>
  );
}

export default function Credentials() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');
  const [showRevoked, setShowRevoked] = useState(false);
  const [kind, setKind] = useState('');
  const [onlyReview, setOnlyReview] = useState(false);
  const [creating, setCreating] = useState(false);
  const [change, setChange] = useState(null);
  const [shown, setShown] = useState(null);
  /* When the list was read: "expires within 30 days" counts from then, not from each render. */
  const [readAt, setReadAt] = useState(0);

  const load = useCallback(() => {
    listCredentials({ revoked: showRevoked })
      .then((r) => {
        setData(r);
        setReadAt(Date.now());
        setFailed('');
      })
      .catch((e) => setFailed(String(e?.message || 'Could not load credentials.')));
  }, [showRevoked]);
  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(
    () => (data?.credentials || []).filter((c) => (!kind || c.kind === kind) && (!onlyReview || c.needsReviewReason)),
    [data, kind, onlyReview]
  );

  const act = async (c, action) => {
    if (action === 'review') {
      await markCredentialReviewed(c.id).then(() => notify.success('Marked reviewed.')).catch((e) => notify.error(String(e?.message || 'Not done.')));
      return load();
    }
    if (action === 'resume') {
      await resumeCredential(c.id).then(() => notify.success('Resumed.')).catch((e) => notify.error(String(e?.message || 'Not done.')));
      return load();
    }
    if (action === 'rotate' && (c.kind === 'AGENT' || c.kind === 'DEVICE_PUSH')) {
      const ok = await confirmDialog({ title: 'Rotate where it is installed', message: c.kind === 'AGENT' ? 'Rotate it in Attendance → Integrations.' : 'Change it in Attendance → Readers.', confirmLabel: 'Open Attendance', tone: 'primary' });
      if (ok) requestOpenApp('attendance', c.kind === 'AGENT' ? 'integrations' : 'devices');
      return undefined;
    }
    return setChange({ action, credential: c });
  };

  const all = data?.credentials || [];
  const soon = readAt + 30 * DAY;
  const counts = {
    working: all.filter((c) => c.effective === 'ACTIVE').length,
    stopped: all.filter((c) => c.effective !== 'ACTIVE' && c.status !== 'REVOKED').length,
    review: all.filter((c) => c.needsReviewReason).length,
    expiring: all.filter((c) => c.status !== 'REVOKED' && c.expiresAt && new Date(c.expiresAt).getTime() <= soon && new Date(c.expiresAt).getTime() > readAt).length,
  };

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Security', 'Credentials']}
          title="Credentials"
          description="Every key and token this company has given to another system: API keys, connectors, readers and directory sync, and whether each works right now."
          actions={
            <button type="button" className="ws-btn ws-btn--primary" disabled={!data?.mayCreateApiKey} title={data?.createBlockedReason || ''} onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" /> New API key
            </button>
          }
        />
        {data?.createBlockedReason ? <p className="ws-card-blurb" style={{ marginTop: -16 }}>{data.createBlockedReason}</p> : null}
        {data?.closing ? <p className="ws-band" data-tone="warn" role="status">Closure scheduled: all credentials are paused.</p> : null}
        {shown ? <ShownOnce label={shown.label} value={shown.value} hint={shown.hint} onDone={() => setShown(null)} /> : null}

        {data ? (
          <div className="ws-stats">
            <Stat icon={ICON.secure} label="Working" value={counts.working} note="Can be used right now" />
            <Stat icon={ICON.warning} tone={counts.stopped ? 'warn' : null} label="Not working" value={counts.stopped} note="Paused, blocked or expired" />
            <Stat icon={ICON.alert} tone={counts.review ? 'warn' : null} label="To review" value={counts.review} note={counts.review ? 'Their maker left or changed' : 'Nothing to look at'} onOpen={counts.review ? () => setOnlyReview(true) : undefined} />
            <Stat icon={ICON.history} label="Expire within 30 days" value={counts.expiring} note="Extend without changing the key" />
          </div>
        ) : null}

        <div className="ws-filters" role="search">
          <select className="ui-select" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Kind: All</option>
            {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} /> Needs review only</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} /> Show revoked</label>
          {data ? <span className="ws-head-meta">{rows.length} shown</span> : null}
        </div>

        {failed ? (
          <div className="flex flex-wrap items-center gap-2 text-sm" role="alert"><span>{failed}</span> <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={load}>Try again</button></div>
        ) : !data ? (
          <p className="ws-card-blurb">Loading credentials…</p>
        ) : rows.length ? (
          <div className="ws-table-wrap">
            <table className="ws-table">
              <caption className="sr-only">Credentials</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Key</th>
                  <th scope="col">Status</th>
                  <th scope="col">Expires</th>
                  <th scope="col">Last used</th>
                  <th scope="col">Made by</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const [word, tone, why] = STATUS[c.effective] || STATUS[c.status] || ['—', 'ui-pill-neutral', ''];
                  return (
                    <tr key={c.id}>
                      <td style={{ whiteSpace: 'normal', minWidth: 220 }}>
                        <div className="font-medium">{c.label || c.owner?.name || KIND[c.kind]}</div>
                        <div className="ws-head-meta">{KIND[c.kind]}{c.owner?.name && c.owner.name !== c.label ? ` · ${c.owner.name}` : ''}{c.scopes ? ` · ${c.scopes.map((x) => SCOPE_LABEL[x] || x).join(', ')}` : ''}</div>
                      </td>
                      <td className="tabular-nums" style={{ fontSize: '0.8125rem' }}>{c.tokenPrefix}…</td>
                      <td style={{ whiteSpace: 'normal', minWidth: 160 }}>
                        <span className="inline-flex flex-wrap gap-1">
                          <span className={TONE[tone] || 'ws-pill ws-pill--neutral'}>{word}</span>
                          {c.needsReviewReason ? <span className="ws-pill ws-pill--warn">Needs review</span> : null}
                        </span>
                        {why && c.effective !== 'COMPANY_CLOSING' ? <div className="ws-head-meta">{why}</div> : null}
                        {c.needsReviewReason ? <div className="ws-head-meta">{c.needsReviewReason}</div> : null}
                      </td>
                      <td>{c.expiresAt ? dateOf(c.expiresAt) : 'Never'}</td>
                      <td>{agoOf(c.lastUsedAt)}</td>
                      <td>{c.createdBy || '—'}</td>
                      <td className="num">
                        <span className="inline-flex justify-end gap-1">
                          {actionsFor(c).map((a) => (
                            <button key={a} type="button" className="ws-btn ws-btn--quiet ws-btn--small" aria-label={`${ACTION_LABEL[a]} ${c.label || KIND[c.kind]}`} onClick={() => act(c, a)}>{ACTION_LABEL[a]}</button>
                          ))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="ws-setup">
            <p className="ws-card-blurb">{data.credentials.length ? 'Nothing matches these filters.' : 'No keys or tokens yet.'}</p>
          </div>
        )}

        {data?.links ? (
          <p className="ws-card-blurb">
            Customer links: {data.links.shareLinks} invoice link{data.links.shareLinks === 1 ? '' : 's'} and {data.links.payLinks} open payment link{data.links.payLinks === 1 ? '' : 's'}. They are managed from each invoice; a link stops when its invoice is cancelled.
          </p>
        ) : null}
      </div>

      {creating ? (
        <NewKey
          scopes={data?.scopes}
          onClose={() => setCreating(false)}
          onDone={(s) => {
            setCreating(false);
            setShown(s);
            load();
          }}
        />
      ) : null}
      {change ? (
        <Change
          action={change.action}
          credential={change.credential}
          onClose={() => setChange(null)}
          onDone={(s, message) => {
            setChange(null);
            if (s) setShown(s);
            if (message) notify.success(message);
            load();
          }}
        />
      ) : null}
    </div>
  );
}
