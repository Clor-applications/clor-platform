import React, { useEffect, useState } from 'react';
import { getFeatures, setFeatures } from '@ui/api/features';
import { getApprovalSettings, saveApprovalSettings } from '../../api/governance';
import { PageHeader, Spinner } from '@ui/components/ui/Primitives';

export default function ApprovalSettings() {
  const [enabled, setEnabled] = useState(false);
  const [policy, setPolicy] = useState({ allowSelfApproval: false, requireApprovalRemarks: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([getFeatures(), getApprovalSettings()])
      .then(([features, settings]) => {
        if (!live) return;
        setEnabled(Boolean(features?.features?.approvals));
        setPolicy(settings?.policy || { allowSelfApproval: false, requireApprovalRemarks: false });
      })
      .catch((e) => { if (live) setError(String(e?.message || e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const save = async () => {
    setSaving(true); setError(''); setNotice('');
    try {
      await setFeatures({ approvals: enabled });
      await saveApprovalSettings(policy);
      setNotice('Approval settings saved');
    } catch (e) { setError(String(e?.message || e)); }
    finally { setSaving(false); }
  };
  return <div className="space-y-3">
    <PageHeader entity="settings" title="Approval Settings" actions={
      <button type="button" className="ui-btn ui-btn-primary" disabled={loading || saving} onClick={save}>
        {saving ? <Spinner /> : null} Save changes
      </button>} />
    {error && <div className="ui-card p-3 text-sm text-[rgb(var(--neg))]" role="alert">{error}</div>}
    {notice && <div className="ui-pill ui-pill-pos" role="status">{notice}</div>}
    {loading ? <div className="flex justify-center p-6"><Spinner /></div> : <div className="ui-card p-4 space-y-4 max-w-2xl">
      <label className="flex items-center justify-between gap-4 text-sm">
        <span><strong>Approval management</strong><span className="block ui-muted text-xs">Apply active workflows to supported transactions.</span></span>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} aria-label="Enable approval management" />
      </label>
      <label className="flex items-center justify-between gap-4 text-sm">
        <span><strong>Allow self approval</strong><span className="block ui-muted text-xs">A creator who holds the approver role may approve their own request.</span></span>
        <input type="checkbox" checked={policy.allowSelfApproval} onChange={(e) => setPolicy({ ...policy, allowSelfApproval: e.target.checked })} />
      </label>
      <label className="flex items-center justify-between gap-4 text-sm">
        <span><strong>Require approval remarks</strong><span className="block ui-muted text-xs">Approvers must enter a note before approving. Rejections always require a reason.</span></span>
        <input type="checkbox" checked={policy.requireApprovalRemarks} onChange={(e) => setPolicy({ ...policy, requireApprovalRemarks: e.target.checked })} />
      </label>
    </div>}
  </div>;
}
