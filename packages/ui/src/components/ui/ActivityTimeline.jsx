import React, { useMemo, useState } from 'react';
import { CheckCircle2, FileUp, MessageSquare, Pencil, Plus, Upload, Download, Archive, XCircle, Eye, Zap } from 'lucide-react';

/**
 * ActivityTimeline (People design spec v1 §5, §7): ERPNext-style history of
 * one record. Each event: who (and their role, or the system), when (shown in
 * the viewer's time, stored UTC), what kind, and the fields that changed with
 * the before and after the viewer may see — a redacted change says "changed"
 * and nothing more. Comments, system events and approvals are separate kinds
 * the reader can filter. The server decides what each viewer gets; this only
 * draws it.
 */
export const EVENT_KINDS = {
  create: { label: 'Created', Icon: Plus },
  update: { label: 'Updated', Icon: Pencil },
  approve: { label: 'Approved', Icon: CheckCircle2 },
  reject: { label: 'Rejected', Icon: XCircle },
  archive: { label: 'Archived', Icon: Archive },
  import: { label: 'Imported', Icon: Upload },
  export: { label: 'Exported', Icon: Download },
  upload: { label: 'Document', Icon: FileUp },
  comment: { label: 'Comment', Icon: MessageSquare },
  view: { label: 'Viewed', Icon: Eye },
  system: { label: 'System', Icon: Zap },
};
const FILTERS = [['', 'All'], ['changes', 'Changes'], ['approvals', 'Approvals'], ['documents', 'Documents'], ['comments', 'Comments'], ['system', 'System']];
const GROUP = { create: 'changes', update: 'changes', archive: 'changes', import: 'changes', approve: 'approvals', reject: 'approvals', upload: 'documents', export: 'system', view: 'system', system: 'system', comment: 'comments' };

const dayOf = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

export default function ActivityTimeline({ events, onLoadMore = null, loadingMore = false, empty = 'Nothing has happened on this record yet.', filter: controlled, onFilterChange }) {
  const [own, setOwn] = useState('');
  const filter = controlled ?? own;
  const setFilter = onFilterChange || setOwn;
  const shown = useMemo(() => (filter ? events.filter((e) => GROUP[e.type] === filter) : events), [events, filter]);
  const days = useMemo(() => {
    const out = [];
    for (const e of shown) {
      const d = dayOf(e.at);
      if (!out.length || out[out.length - 1].day !== d) out.push({ day: d, items: [] });
      out[out.length - 1].items.push(e);
    }
    return out;
  }, [shown]);
  return (
    <div className="ui-activity">
      <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-1">
        {FILTERS.map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={filter === k} className={`ui-pill ${filter === k ? 'ui-pill-info' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {!shown.length ? <p className="ui-muted text-sm mt-3">{filter ? 'Nothing of this kind.' : empty}</p> : null}
      {days.map((g) => (
        <section key={g.day} aria-label={g.day} className="mt-4">
          <h3 className="ui-caption">{g.day}</h3>
          <ol className="ui-activity-list">
            {g.items.map((e) => {
              const k = EVENT_KINDS[e.type] || EVENT_KINDS.system;
              const Icon = k.Icon;
              return (
                <li key={e.id} className={`ui-activity-item is-${GROUP[e.type] || 'system'}`}>
                  <span className="ui-activity-dot" aria-hidden="true"><Icon size={14} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <p className="text-sm font-medium">{e.title || k.label}</p>
                      <time className="ui-caption tabular-nums" dateTime={e.at}>{timeOf(e.at)}</time>
                    </div>
                    {e.changes?.length ? (
                      <ul className="ui-activity-changes">
                        {e.changes.map((c, i) => (
                          <li key={`${c.field}-${i}`}>
                            <span className="ui-muted">{c.label || c.field}</span>{' '}
                            {c.redacted ? <span className="ui-muted">changed</span> : <><span className="ui-activity-before">{c.before ?? 'blank'}</span> <span aria-hidden="true">→</span><span className="sr-only">to</span> <span className="ui-activity-after">{c.after ?? 'blank'}</span></>}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {e.body ? <p className="text-sm mt-0.5 whitespace-pre-wrap">{e.body}</p> : null}
                    <p className="ui-caption mt-0.5">
                      {e.actor ? `by ${e.actor}` : 'by Clor'}{e.role ? ` · ${e.role}` : ''}{e.reason ? ` · ${e.reason}` : ''}{e.batch ? ` · part of a batch of ${e.batch.size}` : ''}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {onLoadMore ? <button type="button" className="ui-btn ui-btn-secondary mt-4" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? 'Loading…' : 'Show older'}</button> : null}
    </div>
  );
}
