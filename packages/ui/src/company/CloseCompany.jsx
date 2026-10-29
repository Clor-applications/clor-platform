import React, { useCallback, useEffect, useState } from 'react';
import { Download, TriangleAlert, Undo2 } from '@ui/components/ui/lineIcons';

import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';
import { PageHeader, SkeletonCard } from '../components/ui/Primitives';
import { notify } from '../components/ui/notify';

const base = () => `/orgs/${encodeURIComponent(String(platformOrgId() || ''))}`;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

/**
 * Close this company (LX-07 part 2). Shared, so any app can offer it; the
 * server lets only an administrator of the whole company ask or cancel, and asking needs a
 * fresh authenticator code (the shared request layer prompts for it).
 *
 * The steps are the policy (docs/compliance/DATA_DELETION_AND_CLOSURE.md):
 * download a full export, ask with the company's name typed, a notice period
 * during which the company keeps working and the closure can be cancelled,
 * then every record of the company is deleted and nothing can be recovered.
 */
export default function CloseCompany({ companyName = '' }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    apiFetch(`${base()}/closure`)
      .then((r) => { setState(r); setError(''); })
      .catch((e) => setError(String(e?.message || 'Could not load.')));
  }, []);
  useEffect(() => { load(); }, [load]);

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
  const exportFresh = exportedAt && Date.now() - Date.parse(exportedAt) < 24 * 60 * 60 * 1000;
  const name = closure?.orgName || state?.orgName || companyName;

  return (
    <div className="space-y-3">
      <PageHeader entity="settings" title="Close company" description="Delete this company and everything in it, after a notice period. Only an administrator of the company can do this, with a code from their authenticator app." />
      <div className="pb-8 space-y-4 max-w-3xl">
        {error ? <p className="ui-card p-4 text-sm" role="alert">{error}</p> : null}
        {!state ? (
          error ? null : <SkeletonCard lines={6} />
        ) : !(state.canClose ?? state.isOwner) ? (
          <section className="ui-card p-4 space-y-2">
            <p className="text-sm">Only an administrator of this company can close it{scheduled ? ' or cancel its closure' : ''}.</p>
            {scheduled ? <p className="text-sm">A closure is scheduled: every record of this company is deleted on <strong>{day(closure.deleteAfter)}</strong>.</p> : null}
          </section>
        ) : scheduled ? (
          <section className="ui-card p-4 space-y-3" aria-labelledby="closure-h">
            <h2 id="closure-h" className="ui-t-sec flex items-center gap-2"><TriangleAlert size={18} aria-hidden="true" /> Closure scheduled</h2>
            <p className="text-sm">
              Asked on {day(closure.requestedAt)}. On <strong>{day(closure.deleteAfter)}</strong>, every record of this company is deleted: accounts, invoices, payroll, attendance, employees, users’ access and settings. It cannot be recovered after that.
            </p>
            <p className="text-sm">Until then the company works as normal. Keep your export: the law may require you to keep payroll, tax and attendance records for years.</p>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={cancel} disabled={busy === 'cancel'}>
              <Undo2 size={16} aria-hidden="true" /> {busy === 'cancel' ? 'Cancelling…' : 'Cancel the closure'}
            </button>
          </section>
        ) : (
          <>
            <section className="ui-card p-4 space-y-2" aria-labelledby="what-h">
              <h2 id="what-h" className="ui-t-sec">What happens</h2>
              <ol className="list-decimal ps-5 space-y-1 text-sm">
                <li>You download a full export of the company: every record, as one file.</li>
                <li>You ask to close. The company keeps working for {state.noticeDays} days, and you can cancel at any time in them.</li>
                <li>After {state.noticeDays} days CLOR deletes every record of the company, in every app. Nothing is kept and nothing can be recovered.</li>
              </ol>
              <p className="ui-caption">Labour, tax and PF law may require your business to keep payroll, tax and attendance records for several years. After the closure, that copy is your export.</p>
            </section>

            <section className="ui-card p-4 space-y-3" aria-labelledby="export-h">
              <h2 id="export-h" className="ui-t-sec">1. Download a full export</h2>
              <p className="text-sm">{exportedAt ? `Last full export: ${new Date(exportedAt).toLocaleString('en-IN')}.` : 'No full export taken yet.'} The closure needs one from the last 24 hours.</p>
              <button type="button" className="ui-btn ui-btn-secondary" onClick={exportAll} disabled={busy === 'export'}>
                <Download size={16} aria-hidden="true" /> {busy === 'export' ? 'Preparing…' : 'Download full export'}
              </button>
            </section>

            <section className="ui-card p-4 space-y-3" aria-labelledby="ask-h">
              <h2 id="ask-h" className="ui-t-sec">2. Ask to close</h2>
              <label className="block">
                <span className="ui-label">Why are you closing? (optional)</span>
                <input className="ui-input w-full" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              </label>
              <label className="block">
                <span className="ui-label">Type {name} to confirm</span>
                <input className="ui-input w-full" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-label={`Type ${name} to confirm`} />
              </label>
              <button
                type="button"
                className="ui-btn ui-btn-danger"
                data-write
                onClick={ask}
                disabled={busy === 'close' || !exportFresh || !name || typed.trim().toLowerCase() !== name.trim().toLowerCase()}
              >
                {busy === 'close' ? 'Scheduling…' : `Close company after ${state.noticeDays} days`}
              </button>
              {!exportFresh ? <p className="ui-caption">Download the export first.</p> : null}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
