import React, { useState } from 'react';
import { LayoutGrid, List, Plus } from '@ui/components/ui/lineIcons';
import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import ErrorState from '@ui/components/ui/ErrorState';
import SearchField from '@ui/components/ui/SearchField';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { listCandidates, listOpenings, moveCandidate } from '../api/talent';
import CandidateDrawer, { CandidateForm } from './CandidateDrawer';
import { OPEN_STAGES, Pill, SOURCES, STAGES, Tabs, day, useParamState, usePerm, word } from './shared';

/**
 * Candidates (TALENT-DECISIONS.md): everyone applying, on one pipeline from Applied to Hired,
 * as a list or a board of stages. A card moves with its menu (keyboard and phone safe, no
 * drag). Opening a candidate shows their résumé, interviews, offers and timeline.
 */
const TABS = [['open', 'In the running'], ['APPLIED', 'Applied'], ['SCREENING', 'Screening'], ['INTERVIEW', 'Interview'], ['OFFER', 'Offer'], ['HIRED', 'Hired'], ['closed', 'Not going ahead'], ['all', 'All']];
const COUNT_KEY = { open: 'open', closed: 'closed' };
const VIEW_KEY = 'clor.people.candidates.view';
const readView = () => { try { return localStorage.getItem(VIEW_KEY) === 'board' ? 'board' : 'list'; } catch { return 'list'; } };

export default function Candidates({ params = {}, openScreen }) {
  const allowed = usePerm();
  const canCreate = allowed('PEOPLE::Recruitment::CREATE');
  const canEdit = allowed('PEOPLE::Recruitment::EDIT');
  const canHire = canEdit && allowed('PEOPLE::Employees::CREATE');
  const canOffer = canEdit && allowed('PEOPLE::Documents::CREATE');
  const [stage, setStage] = useState('open');
  const [opening, setOpening] = useParamState(params?.opening, '');
  const [q, setQ] = useState('');
  const [view, setView] = useState(readView);
  const [open, setOpen] = useParamState(params?.id);
  const [adding, setAdding] = useState(false);
  const chooseView = (v) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window */ } };
  const openings = useRequest(() => listOpenings({ status: 'all' }).catch(() => []), []);
  const board = view === 'board';
  const req = useRequest(() => listCandidates({ stage: board ? 'all' : stage, openingId: opening, q, limit: 500 }), [stage, opening, q, board]);
  const rows = req.data?.rows || [];
  const counts = req.data?.counts || {};
  const live = (openings.data || []).filter((o) => !['FILLED', 'CLOSED'].includes(o.status));

  const move = async (r, to) => {
    try { await moveCandidate(r.id, to); notify.success(`${r.name}: ${word(STAGES, to).toLowerCase()}.`); req.reload(); } catch (e) { notify.error(String(e?.message || 'Not moved.')); }
  };
  const columns = [
    { key: 'name', label: 'Candidate', always: true, render: (r) => <span className="min-w-0"><span className="block truncate font-medium">{r.name}</span><span className="block truncate ui-caption">{r.currentEmployer || r.email || r.phone || ''}</span></span> },
    ...(opening ? [] : [{ key: 'opening', label: 'Opening', render: (r) => r.openingTitle || '—' }]),
    { key: 'source', label: 'Came through', render: (r) => word(SOURCES, r.source) },
    { key: 'since', label: 'Since', render: (r) => <span className="tabular-nums whitespace-nowrap">{day(r.stageAt)}</span> },
    { key: 'resume', label: 'Résumé', render: (r) => (r.resume || r.resumeUrl ? 'Yes' : <span className="ui-muted">No</span>) },
    { key: 'stage', label: 'Stage', render: (r) => <Pill map={STAGES} value={r.stage} /> },
  ];
  const oneStage = !['open', 'closed', 'all'].includes(stage);
  const rowActions = (r) => (canEdit && OPEN_STAGES.includes(r.stage) ? OPEN_STAGES.filter((s) => s !== r.stage).map((s) => ({ key: s, label: `Move to ${word(STAGES, s).toLowerCase()}`, onSelect: () => move(r, s) })) : []);
  const filtered = Boolean(q || opening || stage !== 'open');

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'Talent' }, { label: 'Candidates' }]} title="Candidates"
        actions={canCreate ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Add candidate</button> : null} />
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : board ? (
        <>
          <Toolbar {...{ q, setQ, opening, setOpening, openings: openings.data || [], view, chooseView }} />
          <Board rows={rows} loading={req.loading} canEdit={canEdit} onOpen={(r) => setOpen(r.id)} onMove={move} />
        </>
      ) : (
        <DataTable
          tabs={<Tabs label="Stages" tabs={TABS.map(([k, l]) => [k, l, counts[COUNT_KEY[k] || k] || 0])} value={stage} onChange={setStage} />}
          label="Candidates" columns={oneStage ? columns.filter((c) => c.key !== 'stage') : columns}
          rows={rows} loading={req.loading} refreshing={req.refreshing} total={rows.length} pageSize={Math.max(25, rows.length)} noun="candidates"
          onRowClick={(r) => setOpen(r.id)} rowActions={rowActions}
          card={(r) => (
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.name}</span><Pill map={STAGES} value={r.stage} /></span>
              <span className="block truncate ui-caption">{[r.openingTitle, word(SOURCES, r.source), day(r.stageAt)].filter(Boolean).join(' · ')}</span>
            </span>
          )}
          empty={filtered
            ? <EmptyState kind="filtered" title="No candidates match" description="Nothing here matches the search, the opening or the tab." />
            : <EmptyState title="No candidates yet" description="Add someone who applied, or turn on an opening's apply link." routes={canCreate ? [{ label: 'Add candidate', onSelect: () => setAdding(true) }, { label: 'Job openings', onSelect: () => openScreen?.('recruitment') }] : undefined} />}
          toolbar={<ToolbarItems {...{ q, setQ, opening, setOpening, openings: openings.data || [], view, chooseView }} />} />
      )}
      {open ? <CandidateDrawer id={open} hr canEdit={canEdit} canHire={canHire} canOffer={canOffer} onClose={() => setOpen(null)} onChanged={req.reload} onHired={() => openScreen?.('joiners')} /> : null}
      {adding ? <CandidateForm value={{ openingId: opening && live.some((o) => o.id === opening) ? opening : live.length === 1 ? live[0].id : '' }} openings={live} onClose={() => setAdding(false)} onSaved={(c) => { setAdding(false); req.reload(); if (c?.id) setOpen(c.id); }} /> : null}
    </div>
  );
}

function ToolbarItems({ q, setQ, opening, setOpening, openings, view, chooseView }) {
  return (
    <>
      <SearchField value={q} onSearch={setQ} placeholder="Search name, e-mail or phone" label="Search candidates" className="w-full sm:w-72" />
      <div className="w-full sm:w-56"><PopupSelect showValueSubtext={false} ariaLabel="Opening" value={opening} alwaysSearch={openings.length > 8} onChange={(v) => setOpening(v || '')} options={[{ value: '', label: 'Every opening' }, ...openings.map((o) => ({ value: o.id, label: o.title }))]} /></div>
      <div className="inline-flex gap-1" role="group" aria-label="Show as">
        <button type="button" className={`ui-icon-btn ${view === 'list' ? 'is-active' : ''}`} aria-pressed={view === 'list'} aria-label="List" title="List" onClick={() => chooseView('list')}><List size={16} aria-hidden="true" /></button>
        <button type="button" className={`ui-icon-btn ${view === 'board' ? 'is-active' : ''}`} aria-pressed={view === 'board'} aria-label="Board" title="Board" onClick={() => chooseView('board')}><LayoutGrid size={16} aria-hidden="true" /></button>
      </div>
    </>
  );
}
const Toolbar = (props) => <div className="flex flex-wrap items-center gap-2"><ToolbarItems {...props} /></div>;

/** The stages side by side, each card with its own menu to move it; scrolls sideways inside itself on a phone. */
function Board({ rows, loading, canEdit, onOpen, onMove }) {
  const cols = [...OPEN_STAGES, 'HIRED'];
  return (
    <div className="ui-table-scroll" role="region" aria-label="Candidates by stage" tabIndex={0}>
      <div className="grid gap-3 pb-2" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(14rem, 1fr))` }}>
        {cols.map((s) => {
          const here = rows.filter((r) => r.stage === s);
          return (
            <section key={s} aria-label={word(STAGES, s)} className="space-y-2">
              <h3 className="ui-label flex items-center justify-between border-b pb-1.5" style={{ borderColor: 'rgb(var(--border))' }}>{word(STAGES, s)}<span className="tabular-nums">{here.length}</span></h3>
              {loading ? <p className="text-sm ui-muted">Loading…</p> : !here.length ? <p className="text-sm ui-muted">Nobody</p> : here.map((r) => (
                <article key={r.id} className="ui-card p-3 space-y-1">
                  <button type="button" className="block w-full text-left font-medium truncate" onClick={() => onOpen(r)}>{r.name}</button>
                  <p className="ui-caption truncate">{[r.openingTitle, day(r.stageAt)].filter(Boolean).join(' · ')}</p>
                  {canEdit && OPEN_STAGES.includes(s) ? (
                    <PopupSelect showValueSubtext={false} ariaLabel={`Move ${r.name}`} value="" placeholder="Move to…" onChange={(v) => v && onMove(r, v)} options={OPEN_STAGES.filter((x) => x !== s).map((x) => ({ value: x, label: word(STAGES, x) }))} />
                  ) : null}
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
