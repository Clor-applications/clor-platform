import React, { useState } from 'react';
import useRequest from '@ui/components/ui/useRequest';

import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { formatDate } from '@ui/components/ui/DatePicker';
import { notify } from '@ui/components/ui/notify';

import { structureHistory } from './api';

/**
 * Organization → Changes: every change to the company's structure — who
 * created, renamed, moved, retired or merged what, and when (the research's
 * ChangeLedger, built on the change log). Read-only; newest first, one ruled
 * row per change, the fields that changed in words. A link from a list's
 * row menu opens it filtered to that one item.
 */
const ACTION_WORDS = { CREATED: 'Added', RENAMED: 'Renamed', EDITED: 'Changed', MOVED: 'Moved', RETIRED: 'Retired', REACTIVATED: 'Brought back', MERGED: 'Merged', DELETED: 'Deleted' };
const KIND_FILTER = [['all', 'Everything'], ['departments', 'Departments'], ['job-positions', 'Designations'], ['branches', 'Branches'], ['establishments', 'Work Sites'], ['areas', 'Locations'], ['teams', 'Teams'], ['seats', 'Positions'], ['business-units', 'Business Units'], ['grades', 'Grades'], ['cost-centres', 'Cost Centres'], ['job-roles', 'Job Roles']];
const time = (at) => new Date(at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const day = (at) => formatDate(new Date(new Date(at).getTime() + 330 * 60_000).toISOString().slice(0, 10));

export default function Changes({ params = {}, updateParams, openScreen }) {
  const kind = params.kind || '';
  const item = params.item || '';
  /* The first page follows the filter; earlier pages are added below it. A new filter starts over (keyed list). */
  const first = useRequest(() => structureHistory({ kind, id: item, limit: 50 }), [kind, item]);
  const entries = first.data?.entries || null;
  const error = first.error;
  const itemName = item && entries?.[0]?.itemId === item ? entries[0].itemName : null;
  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'People' }, { label: 'Organization', onClick: () => openScreen?.('organization') }, { label: 'Changes' }]} title={itemName ? `Changes: ${itemName}` : 'Changes'} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-64"><PopupSelect showValueSubtext={false} label="Show" value={kind || 'all'} onChange={(v) => updateParams?.({ kind: v && v !== 'all' ? v : null, item: null }, { push: true })} options={KIND_FILTER.map(([value, label]) => ({ value, label }))} /></div>
        {item ? <button type="button" className="ui-btn ui-btn-ghost" onClick={() => updateParams?.({ item: null }, { push: true })}>Show all {KIND_FILTER.find(([k]) => k === kind && k !== 'all')?.[1] || 'changes'}</button> : null}
      </div>
      {error ? <ErrorState error={error} onRetry={first.reload} /> : !entries ? <SkeletonCard lines={6} /> : !entries.length ? (
        <EmptyState title="No changes yet" description="Adding, renaming, moving, retiring or merging anything in the structure is listed here." />
      ) : (
        <ChangeList key={`${kind}|${item}`} kind={kind} item={item} firstPage={entries} firstNext={first.data?.nextBefore || null} />
      )}
    </div>
  );
}

function ChangeList({ kind, item, firstPage, firstNext }) {
  const [older, setOlder] = useState([]);
  /* The server pages by the last entry it sent (nextBefore); none means this is everything. */
  const [next, setNext] = useState(firstNext);
  const [busy, setBusy] = useState(false);
  const entries = [...firstPage, ...older];
  const loadMore = async () => {
    setBusy(true);
    try {
      const r = await structureHistory({ kind, id: item, limit: 50, before: next });
      setOlder((o) => [...o, ...(r?.entries || [])]);
      setNext(r?.nextBefore || null);
    } catch (e) {
      notify.error(String(e?.message || 'Could not load older changes.'));
    } finally { setBusy(false); }
  };
  return (
    <>
      {/* One ruled row per change: what, who and when on the first line; the fields under it. */}
      <ol className="ui-history-list" aria-label="Structure changes">
        {entries.map((e) => (
          <li key={e.id} className="ui-history-row">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-sm"><span className="font-medium">{ACTION_WORDS[e.action] || e.action}</span> {e.kindLabel ? `${e.kindLabel.toLowerCase()} ` : ''}<span className="font-medium">{e.itemName}</span></p>
              <p className="ui-caption"><span className="tabular-nums">{day(e.at)}, {time(e.at)}</span>{e.actorName ? ` · ${e.actorName}` : ''}</p>
            </div>
            {e.changes?.length ? (
              <ul className="mt-1 space-y-0.5 text-sm">
                {e.changes.map((c) => <li key={c.field}><span className="ui-muted">{c.label || c.field}:</span> {c.before ? <><span className="ui-muted">{c.before}</span> → </> : null}<span>{c.after || 'none'}</span></li>)}
              </ul>
            ) : null}
            {e.reason ? <p className="ui-caption mt-1">{e.reason}</p> : null}
          </li>
        ))}
      </ol>
      {next ? <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={loadMore}>{busy ? 'Loading…' : 'Show earlier changes'}</button> : null}
    </>
  );
}
