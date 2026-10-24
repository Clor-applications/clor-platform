import React, { useCallback, useEffect, useState } from 'react';
import { Check, Download, Undo2 } from 'lucide-react';

import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';
import { notify } from '@ui/components/ui/notify';
import { ICON, PageHead, Panel } from './wsKit';
import './workspace.css';

/**
 * Workspace → Data → Close company (redesign W-R9; LX-07 part 2).
 *
 * The same closure as the shared screen in @ui/company/CloseCompany, as a
 * Workspace page: download a full export, ask with the company's name typed,
 * a notice period in which the company keeps working and the closure can be
 * cancelled, then every record is deleted. The server lets only an
 * administrator of the whole company ask or cancel, and asking needs a fresh
 * authenticator code (the shared request layer prompts for it).
 */
const base = () => `/orgs/${encodeURIComponent(String(platformOrgId() || ''))}`;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const DAY = 24 * 60 * 60 * 1000;

export default function CloseCompanyPage({ companyName = '' }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    apiFetch(`${base()}/closure`)
      .then((r) => {
        setState(r);
        setError('');
      })
      .catch((e) => setError(String(e?.message || 'Could not load.')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const exportAll = async () => {
    setBusy('export');
    try {
      const payload = await apiFetch(`${base()}/export?scope=all`, { skipWarehouseHeader: true });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${String(companyName || 'company').replace(/[\\/:*?"<>|]+/g, '-')}-all-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify.success('Full export downloaded. Keep it somewhere safe.');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not export.'));
    } finally {
      setBusy('');
    }
  };

  const ask = async () => {
    setBusy('close');
    try {
      await apiFetch(`${base()}/closure`, { method: 'POST', body: { confirmName: typed, reason: reason || null } });
      notify.success('Closure scheduled. You can cancel it until the date shown.');
      setTyped('');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not scheduled.'));
    } finally {
      setBusy('');
    }
  };

  const cancel = async () => {
    setBusy('cancel');
    try {
      await apiFetch(`${base()}/closure`, { method: 'DELETE' });
      notify.success('Closure cancelled. Nothing will be deleted.');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not cancelled.'));
    } finally {
      setBusy('');
    }
  };

  const closure = state?.closure;
  const scheduled = closure?.status === 'SCHEDULED';
  const exportedAt = state?.lastFullExportAt;
  const exportFresh = Boolean(exportedAt && Date.now() - Date.parse(exportedAt) < DAY);
  const name = closure?.orgName || state?.orgName || companyName;
  const canClose = state ? (state.canClose ?? state.isOwner) : false;
  const nameMatches = Boolean(name) && typed.trim().toLowerCase() === name.trim().toLowerCase();

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Data', 'Close company']}
          title={`Close ${name || 'this company'}`}
        />

        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}

        {!state ? (
          error ? null : <p className="ws-card-blurb">Loading…</p>
        ) : !canClose ? (
          <Panel title="Only an administrator can close this company">
            <p className="ws-card-blurb">Only an administrator of this company can close it{scheduled ? ' or cancel its closure' : ''}.</p>
            {scheduled ? (
              <p className="text-sm">A closure is scheduled: every record of this company is deleted on <strong>{day(closure.deleteAfter)}</strong>.</p>
            ) : null}
          </Panel>
        ) : scheduled ? (
          <section className="ws-danger" aria-labelledby="closure-h">
            <h2 id="closure-h" className="flex items-center gap-2">
              <span className="ws-tile ws-tile--danger ws-tile--sm" aria-hidden="true"><ICON.warning size={14} /></span>
              Closure scheduled for {day(closure.deleteAfter)}
            </h2>
            <p className="text-sm">
              Requested {day(closure.requestedAt)}. On <strong>{day(closure.deleteAfter)}</strong> every record of this company is deleted and cannot be recovered.
            </p>
            <p className="text-sm">The company works as normal until then.</p>
            <div>
              <button type="button" className="ws-btn ws-btn--quiet" onClick={cancel} disabled={busy === 'cancel'}>
                <Undo2 size={16} aria-hidden="true" /> {busy === 'cancel' ? 'Cancelling…' : 'Cancel the closure'}
              </button>
            </div>
          </section>
        ) : (
          <div className="ws-layout">
            <div className="grid gap-5 min-w-0">
              <Panel title="1. Download a full export">
                <p className="ws-card-blurb">
                  {exportedAt ? `Last full export: ${new Date(exportedAt).toLocaleString('en-IN')}.` : 'No full export taken yet.'} The closure needs one from the last 24 hours.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="ws-btn ws-btn--quiet" onClick={exportAll} disabled={busy === 'export'}>
                    <Download size={16} aria-hidden="true" /> {busy === 'export' ? 'Preparing…' : 'Download full export'}
                  </button>
                  {exportFresh ? (
                    <span className="ws-pill ws-pill--ok">Done in the last 24 hours</span>
                  ) : null}
                </div>
              </Panel>

              <section className="ws-danger" aria-labelledby="ask-h">
                <h2 id="ask-h">2. Ask to close</h2>
                <p className="text-sm">The company keeps working for {state.noticeDays} days and you can cancel at any time in them. After that, nothing can be recovered.</p>
                <label className="grid gap-1">
                  <span className="text-sm font-medium">Why are you closing? (optional)</span>
                  <input className="ui-input w-full" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-medium">Type {name} to confirm</span>
                  <input className="ui-input w-full" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-label={`Type ${name} to confirm`} spellCheck={false} />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="ws-btn ws-btn--danger"
                    data-write
                    onClick={ask}
                    disabled={busy === 'close' || !exportFresh || !nameMatches}
                  >
                    {busy === 'close' ? 'Scheduling…' : `Close company after ${state.noticeDays} days`}
                  </button>
                  {!exportFresh ? <span className="ws-head-meta">Download the export first.</span> : null}
                </div>
              </section>
            </div>

            <aside className="ws-side">
              <Panel title="What happens">
                <ol className="ws-list">
                  {[
                    ['Export', 'Download a full export.', exportFresh],
                    ['Notice period', `${state.noticeDays} days to change your mind. The company keeps working.`, false],
                    ['Deletion', 'Every record, in every app, is deleted for good.', false],
                  ].map(([title, text, done], i) => (
                    <li key={title}>
                      <div className="ws-item" style={{ alignItems: 'flex-start' }}>
                        <span className={`ws-tile ws-tile--sm${i === 2 ? ' ws-tile--danger' : ''}`} aria-hidden="true">
                          {done ? <Check size={14} /> : <span className="text-xs font-semibold">{i + 1}</span>}
                        </span>
                        <span className="ws-item-text">
                          <span className="ws-item-title">{title}</span>
                          <span className="ws-item-sub" style={{ whiteSpace: 'normal' }}>{text}</span>
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="ws-card-blurb">Keep the export; the law may require the records.</p>
              </Panel>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
