import React, { useEffect, useState } from 'react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { getReaderPhoto, listBiometrics } from '../api/attendance';
import { notify } from '@ui/components/ui/notify';
import LoadFailed from '../components/LoadFailed';

/**
 * Who has fingerprints and a face on record, as the readers enrolled them.
 * Counts only: template data stays on the server and the readers. Someone
 * marked as having left is removed from every reader and from here.
 */
export default function Enrolments() {
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [q, setQ] = useState('');
  const [photo, setPhoto] = useState(null);
  const showPhoto = async (r) => {
    try {
      const p = await getReaderPhoto(r.pin);
      setPhoto({ src: p.photo, caption: `${r.employeeName || r.pin} · from the reader` });
    } catch (e) {
      notify.error(String(e?.message || 'No photo.'));
    }
  };
  useEffect(() => {
    listBiometrics().then((v) => { setRows(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load enrolments.')));
  }, [attempt]);
  const shown = (rows || []).filter((r) => !q.trim() || `${r.employeeName || ''} ${r.employeeCode || ''} ${r.pin}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="Enrolments"
        description="Fingerprints and faces enrolled on the readers. Enrol once on any reader; it is copied to the others."
        actions={<input type="search" className="ui-input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search enrolments" />}
      />
      <LoadFailed message={loadError} onRetry={() => setAttempt((n) => n + 1)} />
      {!rows ? (
        loadError ? null : <SkeletonCard lines={5} />
      ) : !rows.length ? (
        <EmptyState title="Nothing enrolled yet" description="Enrol people at a reader, or use “Fetch fingerprints & faces” on a reader that already has them." />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll ui-table-fit">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Employee</th>
                  <th scope="col" className="ui-th">Reader ID</th>
                  <th scope="col" className="ui-th text-end">Fingerprints</th>
                  <th scope="col" className="ui-th ui-col-h-center">Face</th>
                  <th scope="col" className="ui-th ui-col-h-center hidden md:table-cell">Photo</th>
                  <th scope="col" className="ui-th">Last enrolled</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.pin}>
                    <td className="ui-col-entity">{r.employeeName || <span className="ui-caption" style={{ color: 'rgb(var(--warn-ink))' }}>not matched to an employee</span>}</td>
                    <td className="ui-mono">{r.pin}</td>
                    <td className="text-end tabular-nums">{r.fingers || '—'}</td>
                    <td className="ui-col-h-center">{r.faces ? '✓' : '—'}</td>
                    <td className="ui-col-h-center hidden md:table-cell">{r.photo ? <button type="button" className="ui-link text-sm" onClick={() => showPhoto(r)}>View</button> : '—'}</td>
                    <td className="ui-col-meta whitespace-nowrap">{r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {photo ? (
        <div className="ui-nav-sheet" role="dialog" aria-modal="true" aria-label="Photo from the reader" onClick={() => setPhoto(null)}>
          <div className="ui-nav-sheet-backdrop" aria-hidden="true" />
          <div className="ui-card p-3 space-y-2" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', maxWidth: '20rem' }} onClick={(e) => e.stopPropagation()}>
            <img src={photo.src} alt={photo.caption} className="w-full rounded-lg" />
            <div className="flex items-center justify-between gap-2">
              <span className="ui-caption">{photo.caption}</span>
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setPhoto(null)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
