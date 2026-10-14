import React, { useEffect, useState } from 'react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { listBiometrics } from '../api/attendance';

/**
 * Who has fingerprints and a face on record, as the readers enrolled them.
 * Counts only: template data stays on the server and the readers. Someone
 * marked as having left is removed from every reader and from here.
 */
export default function Enrolments() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    listBiometrics().then(setRows).catch((e) => notify.error(String(e?.message || 'Could not load enrolments.')));
  }, []);
  const shown = (rows || []).filter((r) => !q.trim() || `${r.employeeName || ''} ${r.employeeCode || ''} ${r.pin}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="Enrolments"
        description="Fingerprints and faces enrolled on the readers. Enrol once on any reader; it is copied to the others."
        actions={<input type="search" className="ui-input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search enrolments" />}
      />
      {!rows ? (
        <SkeletonCard lines={5} />
      ) : !rows.length ? (
        <EmptyState title="Nothing enrolled yet" description="Enrol people at a reader, or use “Fetch fingerprints & faces” on a reader that already has them." />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Employee</th>
                  <th scope="col" className="ui-th">Reader ID</th>
                  <th scope="col" className="ui-th text-end">Fingerprints</th>
                  <th scope="col" className="ui-th ui-col-h-center">Face</th>
                  <th scope="col" className="ui-th">Last enrolled</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.pin}>
                    <td className="ui-col-entity">{r.employeeName || <span className="ui-caption" style={{ color: 'rgb(var(--warn-ink))' }}>not matched to an employee</span>}</td>
                    <td className="font-mono">{r.pin}</td>
                    <td className="text-end tabular-nums">{r.fingers || '—'}</td>
                    <td className="ui-col-h-center">{r.faces ? '✓' : '—'}</td>
                    <td className="ui-col-meta whitespace-nowrap">{r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
