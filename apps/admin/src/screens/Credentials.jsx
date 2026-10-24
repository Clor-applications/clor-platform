import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Plus } from 'lucide-react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import Modal from '@ui/components/ui/Modal';
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

/**
 * Company admin → Credentials (Batch 5).
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
    <Modal title="New API key" onClose={onClose} maxWidthClass="max-w-lg">
      <form onSubmit={submit} className="space-y-3">
        <label className="block"><span className="ui-label">Name *</span><input className="ui-input w-full" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="What uses it, e.g. greytHR sync" /></label>
        <fieldset>
          <legend className="ui-label">It may</legend>
          {(scopes || Object.keys(SCOPE_LABEL)).map((k) => (
            <label key={k} className="flex items-center gap-2 py-0.5 text-sm">
              <input type="checkbox" className="ui-checkbox" checked={form.scopes.includes(k)} onChange={() => toggle(k)} /> {SCOPE_LABEL[k] || k}
            </label>
          ))}
        </fieldset>
        <label className="block"><span className="ui-label">Only from these addresses</span><input className="ui-input w-full" value={form.allowedIps} onChange={(e) => setForm({ ...form, allowedIps: e.target.value })} placeholder="Blank = anywhere; e.g. 203.0.113.10" /></label>
        <label className="block"><span className="ui-label">Expires</span>
          <select className="ui-select" value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })}>
            <option value="365">In a year</option>
            <option value="180">In 6 months</option>
            <option value="90">In 3 months</option>
            <option value="none">Never</option>
          </select>
        </label>
        <p className="ui-caption">You are reminded before it expires, and can extend it without changing the key.</p>
        <div className="flex gap-2">
          <button type="submit" className="ui-btn ui-btn-primary" disabled={busy || !form.scopes.length}>{busy ? 'Making…' : 'Make the key'}</button>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
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
      ? 'It stops at once and can be resumed. An identity provider that keeps being refused may quarantine the app; resuming here does not lift that — restart provisioning there.'
      : 'It stops at once and can be resumed.',
    rotate: credential.kind === 'SCIM' ? 'A new token is made and the current one stops at once. Paste the new one into your identity provider.' : 'A new key is made and the current one stops at once. Whatever uses it needs the new one.',
    revoke: 'It stops for good. Make a new one if it is needed again.',
    extend: 'The same key keeps working until the new date — at most a year from today.',
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
    <Modal title={`${ACTION_LABEL[action]} ${KIND[credential.kind].toLowerCase()} ${credential.tokenPrefix}…`} onClose={onClose} maxWidthClass="max-w-md">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm">{words}</p>
        {action === 'extend' ? (
          <label className="block"><span className="ui-label">Keep it working for</span>
            <select className="ui-select" value={months} onChange={(e) => setMonths(e.target.value)}>
              <option value="3">3 more months from today</option>
              <option value="6">6 more months from today</option>
              <option value="12">A year from today</option>
            </select>
          </label>
        ) : (
          <>
            <label className="block"><span className="ui-label">Why</span>
              <select className="ui-select" value={reason} onChange={(e) => setReason(e.target.value)}>
                {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="block"><span className="ui-label">Note</span><input className="ui-input w-full" maxLength={150} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — kept in the history" /></label>
          </>
        )}
        <div className="flex gap-2">
          <button type="submit" className={`ui-btn ${action === 'revoke' ? 'ui-btn-danger' : 'ui-btn-primary'}`} disabled={busy}>{busy ? 'Working…' : ACTION_LABEL[action]}</button>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
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

  const load = useCallback(() => {
    listCredentials({ revoked: showRevoked })
      .then((r) => {
        setData(r);
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
      const ok = await confirmDialog({ title: 'Rotate where it is installed', message: c.kind === 'AGENT' ? 'A connector’s token is rotated under Attendance → Integrations, so it can be reinstalled there.' : 'A reader’s address is changed under Attendance → Readers, where the reader is set up.', confirmLabel: 'Open Attendance', tone: 'primary' });
      if (ok) requestOpenApp('attendance', c.kind === 'AGENT' ? 'integrations' : 'devices');
      return undefined;
    }
    return setChange({ action, credential: c });
  };

  return (
    <div className="space-y-3">
      <PageHeader
        entity="settings"
        title="Credentials"
        description="Every key and token this company has given to another system, what each can do now, and who made it."
        actions={
          <button type="button" className="ui-btn ui-btn-primary" disabled={!data?.mayCreateApiKey} title={data?.createBlockedReason || ''} onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" /> New API key
          </button>
        }
      />
      {data?.createBlockedReason ? <p className="ui-caption px-4 sm:px-0">{data.createBlockedReason}</p> : null}
      {data?.closing ? <div className="ui-card p-3 text-sm" role="status" style={{ borderColor: 'rgb(var(--warn-ink))' }}>This company’s closure is scheduled: every credential is paused until it is cancelled.</div> : null}
      {shown ? <ShownOnce label={shown.label} value={shown.value} hint={shown.hint} onDone={() => setShown(null)} /> : null}

      <div className="flex flex-wrap items-end gap-3 px-4 sm:px-0">
        <label className="block"><span className="ui-label">Kind</span>
          <select className="ui-select" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All</option>
            {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} /> Needs review only</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} /> Show revoked</label>
      </div>

      {failed ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="alert"><span>{failed}</span> <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={load}>Try again</button></div>
      ) : !data ? (
        <SkeletonCard lines={4} />
      ) : rows.length ? (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <th scope="col" className="ui-col-grow">Name</th>
                <th scope="col">Key</th>
                <th scope="col" className="ui-col-h-center">Status</th>
                <th scope="col" className="ui-col-date">Expires</th>
                <th scope="col" className="ui-col-date">Last used</th>
                <th scope="col">Made by</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {rows.map((c) => {
                const [word, tone, why] = STATUS[c.effective] || STATUS[c.status] || ['—', 'ui-pill-neutral', ''];
                return (
                  <tr key={c.id}>
                    <td className="ui-col-entity">
                      <div>{c.label || c.owner?.name || KIND[c.kind]}</div>
                      <div className="ui-caption">{KIND[c.kind]}{c.owner?.name && c.owner.name !== c.label ? ` · ${c.owner.name}` : ''}{c.scopes ? ` · ${c.scopes.map((s) => SCOPE_LABEL[s] || s).join(', ')}` : ''}</div>
                    </td>
                    <td className="ui-mono text-xs whitespace-nowrap">{c.tokenPrefix}…</td>
                    <td className="ui-col-h-center">
                      <span className={`ui-pill ${tone}`}>{word}</span>
                      {c.needsReviewReason ? <span className="ui-pill ui-pill-warn ml-1">Needs review</span> : null}
                      {why && c.effective !== 'COMPANY_CLOSING' ? <div className="ui-caption">{why}</div> : null}
                      {c.needsReviewReason ? <div className="ui-caption">{c.needsReviewReason}</div> : null}
                    </td>
                    <td className="ui-col-date whitespace-nowrap">{c.expiresAt ? dateOf(c.expiresAt) : 'Never'}</td>
                    <td className="ui-col-date whitespace-nowrap">{agoOf(c.lastUsedAt)}</td>
                    <td>{c.createdBy || '—'}</td>
                    <td className="ui-col-meta whitespace-nowrap text-end">
                      <div className="inline-flex justify-end gap-1">
                        {actionsFor(c).map((a) => (
                          <button key={a} type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label={`${ACTION_LABEL[a]} ${c.label || KIND[c.kind]}`} onClick={() => act(c, a)}>{ACTION_LABEL[a]}</button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-10 text-center">
          <KeyRound size={20} aria-hidden="true" className="ui-muted mx-auto" />
          <p className="mt-2 text-sm">{data.credentials.length ? 'Nothing matches these filters.' : 'No credentials yet. API keys you make, and connectors, readers and directory sync set up elsewhere, appear here.'}</p>
        </div>
      )}

      {data?.links ? (
        <p className="ui-caption px-4 sm:px-0">
          Customer links: {data.links.shareLinks} invoice link{data.links.shareLinks === 1 ? '' : 's'} and {data.links.payLinks} open payment link{data.links.payLinks === 1 ? '' : 's'}. They are managed from each invoice; a link stops when its invoice is cancelled.
        </p>
      ) : null}

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
