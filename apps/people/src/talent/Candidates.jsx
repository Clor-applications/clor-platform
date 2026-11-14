import React, { useState } from 'react';
import { Plus } from '@ui/components/ui/lineIcons';
import { StatTiles, TILE_ICON } from '@ui/timeOff/Figures';
import { Avatar } from '@ui/personnel/Employees';
import ListHeader, { ListEmpty as EmptyState } from '@ui/components/list/ListHeader';
import DataTable from '@ui/components/ui/DataTable';
import ErrorState from '@ui/components/ui/ErrorState';
import SearchField from '@ui/components/ui/SearchField';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { listCandidates, listOpenings, moveCandidate } from '../api/talent';
import CandidateDrawer, { CandidateForm } from './CandidateDrawer';
import { OPEN_STAGES, Pill, SOURCES, STAGES, day, tabItems, useParamState, usePerm, word } from './shared';

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
  /* The figures (R&D PEOPLE-19), from the stage counts the list answers with; on the board every stage is in the rows. */
  const n = (k) => (board ? rows.filter((r) => (k === 'open' ? OPEN_STAGES.includes(r.stage) : r.stage === k)).length : Number(counts[k]) || 0);
  const sources = board ? rows.filter((r) => OPEN_STAGES.includes(r.stage) || r.stage === 'HIRED').reduce((m, r) => { if (r.source) m[r.source] = (m[r.source] || 0) + 1; return m; }, {}) : {};
  const best = Object.entries(sources).sort((a, b) => b[1] - a[1])[0];
  const forOne = opening ? (openings.data || []).find((o) => o.id === opening) : null;
  const tiles = req.data ? [
    { key: 'open', label: 'In the pipeline', value: n('open'), accent: 1, Icon: TILE_ICON.people, sub: forOne ? forOne.title : 'Every opening' },
    { key: 'interview', label: 'At interview', value: n('INTERVIEW'), accent: 2, Icon: TILE_ICON.time, sub: n('SCREENING') ? `${n('SCREENING')} in screening` : null },
    { key: 'offer', label: 'Offers out', value: n('OFFER'), accent: 3, Icon: TILE_ICON.done },
    best ? { key: 'source', label: 'Best source', value: word(SOURCES, best[0]), accent: 4, Icon: TILE_ICON.job, sub: `${best[1]} of ${Object.values(sources).reduce((a, x) => a + x, 0)} candidates` }
      : { key: 'hired', label: 'Hired', value: n('HIRED'), accent: 4, Icon: TILE_ICON.award },
  ] : null;

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
      <ListHeader
        module="Talent"
        title="Candidates"
        description="Everyone applying, on one pipeline from applied to hired, as a list or a board of stages."
        primary={canCreate ? { label: 'Add candidate', icon: Plus, onClick: () => setAdding(true) } : null}
        strip={tiles ? <StatTiles label="Candidate figures" items={tiles} /> : null}
        toolbar={<ToolbarItems {...{ q, setQ, opening, setOpening, openings: openings.data || [], view, chooseView }} />}
        tabs={board ? null : tabItems(TABS.map(([k, l]) => [k, l, counts[COUNT_KEY[k] || k] || 0]))}
        tab={stage}
        onTab={setStage}
        tabsLabel="Stages"
      />
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : board ? (
        <Board rows={rows} loading={req.loading} canEdit={canEdit} onOpen={(r) => setOpen(r.id)} onMove={move} />
      ) : (
        <DataTable
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
            : <EmptyState title="No candidates yet" description="Add someone who applied, or turn on an opening's apply link." routes={canCreate ? [{ label: 'Add candidate', onSelect: () => setAdding(true) }, { label: 'Job openings', onSelect: () => openScreen?.('recruitment') }] : undefined} />} />
      )}
      {open ? <CandidateDrawer id={open} hr known={rows} canEdit={canEdit} canHire={canHire} canOffer={canOffer} onClose={() => setOpen(null)} onChanged={req.reload} onHired={() => openScreen?.('joiners')} /> : null}
      {adding ? <CandidateForm value={{ openingId: opening && live.some((o) => o.id === opening) ? opening : live.length === 1 ? live[0].id : '' }} openings={live} known={rows} onClose={() => setAdding(false)} onSaved={(c) => { setAdding(false); req.reload(); if (c?.id) setOpen(c.id); }} /> : null}
    </div>
  );
}

function ToolbarItems({ q, setQ, opening, setOpening, openings, view, chooseView }) {
  return (
    <>
      <SearchField value={q} onSearch={setQ} placeholder="Search name, e-mail or phone" label="Search candidates" className="w-full sm:w-72" />
      <div className="w-full sm:w-56"><PopupSelect showValueSubtext={false} ariaLabel="Opening" value={opening} alwaysSearch={openings.length > 8} onChange={(v) => setOpening(v || '')} options={[{ value: '', label: 'Every opening' }, ...openings.map((o) => ({ value: o.id, label: o.title }))]} /></div>
      <div className="pt-seg" role="group" aria-label="Show as">
        <button type="button" className="pt-seg-item" aria-pressed={view === 'board'} onClick={() => chooseView('board')}>Board</button>
        <button type="button" className="pt-seg-item" aria-pressed={view === 'list'} onClick={() => chooseView('list')}>List</button>
      </div>
    </>
  );
}
const Toolbar = (props) => <div className="flex flex-wrap items-center gap-2"><ToolbarItems {...props} /></div>;

/** The stages side by side, each card with its own menu to move it; scrolls sideways inside itself on a phone. */
function Board({ rows, loading, canEdit, onOpen, onMove }) {
  const cols = [...OPEN_STAGES, 'HIRED'];
  return (
    <div className="pt-board" role="region" aria-label="Candidates by stage" tabIndex={0}>
        {cols.map((s) => {
          const here = rows.filter((r) => r.stage === s);
          return (
            <section key={s} aria-label={word(STAGES, s)} className="pt-lane">
              <h3 className="pt-lane-head">{word(STAGES, s)}<span>{here.length}</span></h3>
              {loading ? <p className="text-sm ui-muted">Loading…</p> : !here.length ? <p className="text-sm ui-muted">Nobody</p> : here.map((r) => (
                <article key={r.id} className="pt-cand">
                  <button type="button" className="flex w-full min-w-0 items-center gap-2.5 text-left" onClick={() => onOpen(r)}>
                    <Avatar person={{ name: r.name }} size={28} />
                    <span className="min-w-0"><span className="block truncate font-medium">{r.name}</span><span className="block truncate ui-caption">{r.currentEmployer || r.openingTitle || ''}</span></span>
                  </button>
                  <p className="flex items-center justify-between gap-2 ui-caption"><span className="pt-chip">{word(SOURCES, r.source) || 'No source'}</span><span className="tabular-nums">{day(r.stageAt)}</span></p>
                  {canEdit && OPEN_STAGES.includes(s) ? (
                    <PopupSelect showValueSubtext={false} ariaLabel={`Move ${r.name}`} value="" placeholder="Move to…" onChange={(v) => v && onMove(r, v)} options={OPEN_STAGES.filter((x) => x !== s).map((x) => ({ value: x, label: word(STAGES, x) }))} />
                  ) : null}
                </article>
              ))}
            </section>
          );
        })}
    </div>
  );
}
