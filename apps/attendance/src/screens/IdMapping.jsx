import React, { useCallback, useEffect, useState } from 'react';
import { Link2, Pencil, Plus, Trash2, UserX } from 'lucide-react';

import { EmptyState, PageHeader, SkeletonCard, StatTile } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listStructure } from '@ui/personnel/api';
import { getEmployeeReaderIds, getMappingAudit, listEmployees, listSiteReaderIds, matchPunches, removeReaderExtras, saveEmployeeReaderIds } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';

/**
 * Reader IDs and employees, checked against each other: punches from IDs that
 * match nobody (with a likely match where the reader's name or the employee
 * code says so), people who have left but are still on a reader, IDs on a
 * reader that belong to no employee, and employees with no reader ID at all.
 */
export default function IdMapping({ openScreen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [sites, setSites] = useState([]);
  const [editing, setEditing] = useState(null);
  /* One search across every list on the page (AT-03): a name, a code or a reader ID. */
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const hit = (...vals) => !q || vals.filter(Boolean).join(' ').toLowerCase().includes(q);
  const load = useCallback(() => {
    getMappingAudit().then((d) => { setData(d); setError(''); }).catch((e) => setError(String(e?.message || 'Could not check the reader IDs.')));
    listSiteReaderIds().then(setSites).catch(() => setSites([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const match = async (u, onlyHere = false) => {
    const where = onlyHere ? ` at ${u.areaName} only` : '';
    const ok = await confirmDialog({ title: `Give reader ID ${u.pin} to ${u.suggestion.name}${where}?`, message: `${u.punches} punch${u.punches === 1 ? '' : 'es'} become ${u.suggestion.name}'s, and those days are worked out again. ${u.suggestion.why}.${onlyHere ? ` Elsewhere ${u.suggestion.name} keeps their company-wide ID.` : ''}`, confirmLabel: 'Match', tone: 'default' });
    if (!ok) return;
    try {
      await matchPunches(u.pin, u.suggestion.employeeId, onlyHere ? u.areaId : null);
      notify.success(`Reader ID ${u.pin} is now ${u.suggestion.name}.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not matched.'));
    }
  };
  const removeStale = async (deviceId, name) => {
    const ok = await confirmDialog({ title: `Remove people who are not expected on ${name}?`, message: 'People who have left (and anyone outside the reader’s area) are taken off this reader the next time it checks in. Their past punches stay.', confirmLabel: 'Remove them' });
    if (!ok) return;
    try {
      await removeReaderExtras(deviceId);
      notify.success('Queued for the reader.');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not queued.'));
    }
  };

  const staleByReader = (data?.stale || []).filter((s) => hit(s.employee, s.pin, s.reader)).reduce((m, s) => m.set(s.deviceId, [...(m.get(s.deviceId) || []), s]), new Map());
  return (
    <div className="space-y-3">
      <PageHeader
        entity="reader"
        title="Employee ID mapping"
        description="Reader IDs against employees: what matches nobody, who has left but is still on a reader, who has no ID."
        actions={<button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing({})}><Plus size={16} aria-hidden="true" /> Add ID at a site</button>}
      />
      <div className="pb-8 space-y-6">
      <input type="search" className="ui-input w-full max-w-md" placeholder="Search a name, employee code or reader ID…" aria-label="Search ID mapping" value={query} onChange={(e) => setQuery(e.target.value)} />
      <details className="ui-card p-4 text-sm">
        <summary className="cursor-pointer font-medium">How a punch finds its person</summary>
        <ol className="mt-2 list-decimal space-y-1 ps-5 ui-caption">
          <li>A reader sends the ID it knows the person by (the number they were enrolled under), with the time.</li>
          <li>On a reader that belongs to a site, a <strong>site ID</strong> is checked first: “at the depot, 105 is Sita”. Use one when two sites gave the same number to different people.</li>
          <li>Otherwise the person’s <strong>Reader ID</strong> on their employee file, which holds at every reader.</li>
          <li>Otherwise their <strong>employee code</strong>, when only one person has that code. Leading zeros are ignored, so 0105 and 105 are the same.</li>
          <li>No match: the punch is kept under “Unknown reader IDs” until you say whose it is. Matching it sets the ID, and their past punches become days.</li>
        </ol>
        <p className="ui-caption mt-2">Someone with a site ID is known at that site’s readers by that ID only. Readers with no site use company-wide IDs. When CLOR puts a person on a reader, it uses the ID they have there.</p>
      </details>
      <LoadFailed message={error} onRetry={load} />
      {!data ? (
        error ? null : <SkeletonCard lines={6} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Unknown IDs with punches" value={data.counts.unmatched} tone={data.counts.unmatched ? 'neg' : 'neutral'} />
            <StatTile label="Left, still on a reader" value={data.counts.stale} tone={data.counts.stale ? 'warn' : 'neutral'} />
            <StatTile label="On a reader, no employee" value={data.counts.orphan} />
            <StatTile label="Employees with no reader ID" value={data.counts.noPin} />
          </div>

          <section className="ui-card overflow-hidden" aria-labelledby="unk-h">
            <h2 id="unk-h" className="ui-t-sec px-4 pt-4 pb-2">Unknown reader IDs with punches</h2>
            {data.unmatched.length ? (
              <div className="ui-table-scroll">
                <table className="ui-table ui-table-sticky w-full">
                  <thead><tr><th scope="col">Reader ID</th><th scope="col">Site</th><th className="ui-col-grow" scope="col">Name on the reader</th><th scope="col" className="ui-num">Punches</th><th scope="col">Last punch</th><th scope="col">Likely match</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody className="ui-rows">
                    {data.unmatched.filter((u) => hit(u.pin, u.nameOnReader, u.areaName, u.suggestion?.name, u.suggestion?.code)).map((u) => (
                      <tr key={`${u.areaId || ''}|${u.pin}`}>
                        <td className="ui-mono">{u.pin}</td>
                        <td>{u.areaName || <span className="ui-caption">No site</span>}</td>
                        <td>{u.nameOnReader || <span className="ui-caption">—</span>}</td>
                        <td className="ui-num">{u.punches}</td>
                        <td className="ui-col-date whitespace-nowrap">{u.lastAt ? new Date(u.lastAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
                        <td className="ui-col-entity">{u.suggestion ? <span>{u.suggestion.name}{u.suggestion.code ? <span className="ui-caption"> · {u.suggestion.code}</span> : null}<span className="ui-caption block">{u.suggestion.why}</span></span> : <span className="ui-caption">No likely match</span>}</td>
                        <td className="ui-col-meta whitespace-nowrap text-end">
                          {u.suggestion ? (
                            <span className="inline-flex gap-1">
                              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => match(u)}><Link2 size={14} aria-hidden="true" /> Match</button>
                              {u.areaId ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => match(u, true)} title={`Their ID only at ${u.areaName}`}>Only here</button> : null}
                            </span>
                          ) : openScreen ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => openScreen('unmatched')}>Choose…</button> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="ui-caption px-4 pb-4">Every punch belongs to someone.</p>
            )}
          </section>

          <section className="ui-card overflow-hidden" aria-labelledby="stale-h">
            <h2 id="stale-h" className="ui-t-sec px-4 pt-4 pb-2">People who have left but are still on a reader</h2>
            {staleByReader.size ? (
              <ul className="divide-y">
                {[...staleByReader.entries()].map(([deviceId, list]) => (
                  <li key={deviceId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <UserX size={16} aria-hidden="true" className="ui-subtle" />
                    <span className="min-w-0 flex-1 text-sm"><strong>{list[0].reader}</strong>: {list.slice(0, 6).map((s) => `${s.employee} (${s.pin})`).join(', ')}{list.length > 6 ? ` and ${list.length - 6} more` : ''}</span>
                    <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => removeStale(deviceId, list[0].reader)}><UserX size={14} aria-hidden="true" /> Remove from reader</button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ui-caption px-4 pb-4">Nobody who has left is still on a reader.</p>
            )}
          </section>

          <section className="ui-card overflow-hidden" aria-labelledby="site-h">
            <h2 id="site-h" className="ui-t-sec px-4 pt-4 pb-2">IDs that differ by site</h2>
            {sites.length ? (
              <div className="ui-table-scroll">
                <table className="ui-table ui-table-sticky w-full">
                  <thead><tr><th className="ui-col-grow" scope="col">Employee</th><th scope="col">Site</th><th scope="col">ID there</th><th scope="col">Company-wide ID</th><th scope="col"><span className="sr-only">Edit</span></th></tr></thead>
                  <tbody className="ui-rows">
                    {sites.filter((x) => hit(x.name, x.pin, x.areaName, x.companyId)).map((x) => (
                      <tr key={x.id}>
                        <td className="ui-col-entity">{x.name}{x.left ? <span className="ui-caption"> · left</span> : null}</td>
                        <td>{x.areaName}</td>
                        <td className="ui-mono">{x.pin}</td>
                        <td className="ui-mono ui-caption">{x.companyId || '—'}</td>
                        <td className="ui-col-meta text-end"><button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setEditing({ employeeId: x.employeeId })}><Pencil size={14} aria-hidden="true" /> Edit</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="ui-caption px-4 pb-4">None. Everyone has one ID across all readers. Add a site ID when two sites gave the same number to different people.</p>
            )}
          </section>

          <div className="grid items-start gap-3 xl:grid-cols-2">
            <section className="ui-card p-4" aria-labelledby="orphan-h">
              <h2 id="orphan-h" className="ui-t-sec mb-2">On a reader, no employee</h2>
              {data.orphan.length ? (
                <ul className="divide-y text-sm">
                  {data.orphan.filter((o) => hit(o.nameOnReader, o.pin, o.reader)).slice(0, 100).map((o) => <li key={`${o.deviceId}-${o.pin}`} className="flex justify-between gap-3 py-1.5"><span>{o.nameOnReader || 'No name'} <span className="ui-mono ui-caption">{o.pin}</span></span><span className="ui-caption">{o.reader}</span></li>)}
                </ul>
              ) : <p className="ui-caption">None.</p>}
              {data.orphan.length ? <p className="ui-caption mt-2">Give these IDs to an employee under Personnel, or remove them at the reader.</p> : null}
            </section>
            <section className="ui-card p-4" aria-labelledby="nopin-h">
              <h2 id="nopin-h" className="ui-t-sec mb-2">Employees with no reader ID</h2>
              {data.noPin.length ? (
                <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                  {data.noPin.filter((p) => hit(p.name, p.code)).slice(0, 200).map((p) => <li key={p.employeeId} className="truncate">{p.name}{p.code ? <span className="ui-caption"> · {p.code}</span> : null}</li>)}
                </ul>
              ) : <p className="ui-caption">Everyone has one.</p>}
              {data.noPin.length && openScreen ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm mt-2" onClick={() => openScreen('employees')}>Open employees</button> : null}
            </section>
          </div>
          {!data.counts.unmatched && !data.counts.stale && !data.counts.orphan && !data.counts.noPin ? <EmptyState title="Every ID matches" description="Readers and employees agree." /> : null}
        </>
      )}
      </div>
      {editing ? <SiteIdsEditor initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
    </div>
  );
}

/** One person's IDs: the company-wide one, and a different one at each site that needs it. Saving tells those sites' readers. */
function SiteIdsEditor({ initial, onClose, onSaved }) {
  const [people, setPeople] = useState([]);
  const [areas, setAreas] = useState([]);
  const [employeeId, setEmployeeId] = useState(initial.employeeId || '');
  const [loaded, setLoaded] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    listEmployees().then(setPeople).catch(() => setPeople([]));
    listStructure('areas').then(setAreas).catch(() => setAreas([]));
  }, []);
  useEffect(() => {
    if (!employeeId) return undefined;
    let live = true;
    getEmployeeReaderIds(employeeId)
      .then((r) => { if (live) { setLoaded({ employeeId, ...r }); setRows(r.sites.map((x) => ({ ...x }))); } })
      .catch((e) => notify.error(String(e?.message || 'Could not load their IDs.')));
    return () => { live = false; };
  }, [employeeId]);
  const current = loaded && loaded.employeeId === employeeId ? loaded : null;
  const save = async () => {
    setBusy(true);
    try {
      const r = await saveEmployeeReaderIds(employeeId, rows.filter((x) => x.areaId && x.pin.trim()).map((x) => ({ areaId: x.areaId, pin: x.pin.trim() })));
      notify.success(r.changed ? `Saved. ${r.changed} site${r.changed === 1 ? '' : 's'}’ readers are being updated.` : 'Saved. Nothing changed.');
      onSaved();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      title="Reader ID at a site"
      description="For a site whose readers know this person by a different number."
      widthClass="w-[min(34rem,96vw)]"
      actions={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={!current || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}
    >
      <div className="space-y-4">
        <label className="block"><span className="ui-label">Employee</span>
          <select className="ui-select w-full" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Choose…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` · ${p.code}` : ''}</option>)}
          </select>
        </label>
        {current ? (
          <>
            <p className="text-sm">Company-wide ID: <span className="ui-mono">{current.companyId || 'none'}</span>{current.fromCode ? <span className="ui-caption"> (their employee code)</span> : null}</p>
            <ul className="space-y-2">
              {rows.map((x, i) => (
                <li key={i} className="flex flex-wrap items-end gap-2">
                  <label className="min-w-0 flex-1"><span className="ui-label">Site</span>
                    <select className="ui-select w-full" value={x.areaId} onChange={(e) => setRows(rows.map((y, j) => (j === i ? { ...y, areaId: e.target.value } : y)))}>
                      <option value="">Choose…</option>
                      {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </label>
                  <label className="w-32"><span className="ui-label">ID there</span><input className="ui-input w-full ui-mono" maxLength={40} value={x.pin} onChange={(e) => setRows(rows.map((y, j) => (j === i ? { ...y, pin: e.target.value } : y)))} /></label>
                  <button type="button" className="ui-icon-btn" aria-label="Remove this site ID" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={16} aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setRows([...rows, { areaId: '', pin: '' }])}><Plus size={14} aria-hidden="true" /> Add a site</button>
            <p className="ui-caption">That site’s readers drop the old ID and get this person under the new one, with their fingerprints and face. Punches already made there under the new ID by nobody become theirs.</p>
          </>
        ) : employeeId ? <SkeletonCard lines={3} /> : null}
      </div>
    </Drawer>
  );
}
