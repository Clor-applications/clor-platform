import React, { useEffect, useMemo, useState } from 'react';
import { Fingerprint, ScanFace, Users, UserX } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { Pagination, usePaged } from '@ui/components/list/ListPageParts';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { getReaderPhoto, listBiometrics } from '../api/attendance';
import { notify } from '@ui/components/ui/notify';
import LoadFailed from '../components/LoadFailed';

const COLUMNS = {
  employee: (r) => r.employeeName || 'Not matched',
  pin: (r) => r.pin,
  face: (r) => (r.faces ? 'Face' : 'No face'),
  updated: (r) => (r.updatedAt ? String(r.updatedAt).slice(0, 10) : ''),
};

/**
 * Who has fingerprints and a face on record, as the readers enrolled them.
 * Counts only: template data stays on the server and the readers. Someone
 * marked as having left is removed from every reader and from here.
 */
export default function Enrolments() {
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
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
  const search = useListSearch(rows || [], ['employeeName', 'employeeCode', 'pin']);
  const filters = useColumnFilters();
  const shown = filters.applyFilters(search.filtered, COLUMNS);
  const { pageCount, safePage, pageRows } = usePaged(shown, perPage, page);
  useEffect(() => setPage(1), [search.query]);
  const figures = useMemo(() => {
    const list = rows || [];
    return {
      enrolled: list.length,
      fingers: list.filter((r) => r.fingers).length,
      faces: list.filter((r) => r.faces).length,
      unmatched: list.filter((r) => !r.employeeName).length,
    };
  }, [rows]);

  return (
    <DocumentListShell
      entity="reader"
      title="Enrolments"
      description="Fingerprints and faces enrolled on the readers. Enrol once on any reader; it is copied to the others."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search enrolments…', label: 'Search enrolments' }}
      cards={[
        { label: 'Enrolled', value: figures.enrolled, count: true, tone: 'all', Icon: Users },
        { label: 'With fingerprints', value: figures.fingers, count: true, tone: 'paid', Icon: Fingerprint },
        { label: 'With a face', value: figures.faces, count: true, tone: 'sent', Icon: ScanFace },
        { label: 'Not matched', value: figures.unmatched, count: true, tone: 'outstanding', Icon: UserX },
      ]}
    >
      <LoadFailed message={loadError} onRetry={() => setAttempt((n) => n + 1)} />
      {!rows ? (
        loadError ? null : <SkeletonCard lines={5} />
      ) : (
        <>
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <ColumnHeader label="Employee" col="employee" state={filters} />
                  <ColumnHeader label="Reader ID" col="pin" state={filters} />
                  <th scope="col" className="ui-num">Fingerprints</th>
                  <ColumnHeader label="Face" col="face" state={filters} align="center" />
                  <th scope="col" className="ui-col-h-center hidden md:table-cell">Photo</th>
                  <ColumnHeader label="Last enrolled" col="updated" state={filters} type="date" />
                </tr>
              </thead>
              <tbody className="ui-rows">
                {!shown.length ? (
                  <tr>
                    <td colSpan={6}>
                      {rows.length ? (
                        <EmptyState kind="filtered" totalCount={rows.length} title="No enrolments match" description="Nothing matches the search or the column filters." />
                      ) : (
                        <EmptyState
                          icon={Fingerprint}
                          title="Nothing enrolled yet"
                          description="Enrol once on any reader; it is copied to the others. Enrol people at a reader, or use “Fetch fingerprints & faces” on a reader that already has them."
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((r) => (
                    <tr key={r.pin}>
                      <td className="ui-col-entity">{r.employeeName || <span className="ui-caption" style={{ color: 'rgb(var(--warn-ink))' }}>not matched to an employee</span>}</td>
                      <td className="ui-mono">{r.pin}</td>
                      <td className="ui-num">{r.fingers || '—'}</td>
                      <td className="ui-col-h-center">{r.faces ? '✓' : '—'}</td>
                      <td className="ui-col-h-center hidden md:table-cell">{r.photo ? <button type="button" className="ui-link text-sm" onClick={() => showPhoto(r)}>View</button> : '—'}</td>
                      <td className="ui-col-date whitespace-nowrap">{r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination total={shown.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} noun="people" />
        </>
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
    </DocumentListShell>
  );
}
