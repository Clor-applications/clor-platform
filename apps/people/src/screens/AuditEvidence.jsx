import React, { useEffect, useState } from 'react';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

/**
 * The external auditor's view (PRV-06): the documents a live grant names,
 * nothing else. Each open is logged where the company can see it.
 */
const base = () => `/orgs/${encodeURIComponent(orgId())}/people/audit-evidence`;
const opts = { skipWarehouseHeader: true };

export default function AuditEvidence() {
  const [data, setData] = useState(null);
  useEffect(() => {
    apiFetch(base(), opts).then(setData).catch((e) => { notify.error(String(e?.message || 'Could not load.')); setData({ grants: [], documents: [] }); });
  }, []);
  const open = async (d) => {
    try {
      const r = await apiFetch(`${base()}/${encodeURIComponent(d.id)}`, opts);
      const w = window.open();
      if (w) w.location.href = r.document.dataUrl;
    } catch (e) {
      notify.error(String(e?.message || 'Could not open.'));
    }
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Audit evidence" description="The documents the company has shared with you for an audit, until the date shown. Every document you open is recorded for the company." />
      {!data ? <SkeletonCard lines={4} /> : !data.documents.length ? <EmptyState title="Nothing shared with you now" /> : (
        <>
          <ul className="text-sm space-y-0.5">
            {data.grants.map((g) => <li key={g.id}><span className="font-medium">{g.purpose}</span><span className="ui-caption"> · until {new Date(g.untilAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span></li>)}
          </ul>
          <table className="w-full text-sm">
            <thead><tr className="ui-caption text-left"><th className="py-1.5 font-medium">Document</th><th className="py-1.5 font-medium">Kind</th><th className="py-1.5 font-medium">Open until</th></tr></thead>
            <tbody className="divide-y">
              {data.documents.map((d) => (
                <tr key={d.id}>
                  <td className="py-2 pr-2"><button type="button" className="ui-link font-medium" onClick={() => open(d)}>{d.title}</button></td>
                  <td className="py-2 pr-2">{String(d.kind || '').replaceAll('_', ' ').toLowerCase()}</td>
                  <td className="py-2 tabular-nums">{new Date(d.untilAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
