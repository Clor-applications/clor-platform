import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, RefreshCw } from '@ui/components/ui/lineIcons';

import Popover from './Popover';
import { RowMenu } from './RowMenu';

export { RowMenu };

/**
 * DataTable (People design spec v1 §5, §4.2): one table for server-driven
 * lists. The server pages, sorts and filters; this draws the result and asks
 * for the next one. It owns no data.
 *
 * - Sorting: click a sortable header (asc → desc); `aria-sort` says which.
 * - Paging: 25 / 50 / 100 per page, "Showing 1–25 of 248", a five-page window.
 * - Columns: the viewer picks which show and in what order, and the density;
 *   the caller stores that (a saved view or the browser) through `prefs`.
 * - Selection: a checkbox column; the header box chooses the page; the caller
 *   draws the bulk toolbar from `selected`. `canSelect(row)` false leaves a
 *   row without a box (a row that cannot be decided with the others).
 * - Row actions: an ellipsis menu (keyboard: arrows, Enter, Escape); row click
 *   opens the record. A click on a control inside a row never opens it.
 * - Below 640px rows become cards: `card(row)` draws one.
 * - Loading: skeleton rows the shape of the table; refreshing keeps the rows
 *   and shows a quiet "Updating" mark (spec §8 background refresh).
 *
 * columns: [{ key, label, render?(row), sortable?, align?: 'right'|'center', always?: bool, width? }]
 */
const SIZES = [25, 50, 100];

export function visibleColumns(columns, prefs) {
  const order = prefs?.order?.length ? prefs.order : columns.map((c) => c.key);
  const hidden = new Set(prefs?.hidden || []);
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const ordered = [...order.filter((k) => byKey.has(k)), ...columns.map((c) => c.key).filter((k) => !order.includes(k))];
  return ordered.map((k) => byKey.get(k)).filter((c) => c.always || !hidden.has(c.key));
}

function ColumnSettings({ columns, prefs, onPrefs, defaults }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const order = visibleColumns(columns, { ...prefs, hidden: [] }).map((c) => c.key);
  const hidden = new Set(prefs?.hidden || []);
  const move = (key, by) => {
    const next = [...order];
    const i = next.indexOf(key);
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onPrefs({ ...prefs, order: next });
  };
  return (
    <>
      <button ref={btn} type="button" className="ui-btn ui-btn-secondary ui-columns-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Columns3 size={16} aria-hidden="true" /> Columns
      </button>
      {open ? (
        <Popover anchorRef={btn} onClose={() => setOpen(false)} minWidth={260}>
          <div role="dialog" aria-label="Columns" className="p-3 space-y-3">
            <fieldset>
              <legend className="ui-label">Show and order</legend>
              <ul className="space-y-1">
                {order.map((k, i) => {
                  const c = columns.find((x) => x.key === k);
                  return (
                    <li key={k} className="flex items-center gap-2">
                      <label className="flex flex-1 items-center gap-2 text-sm">
                        <input type="checkbox" className="ui-checkbox" checked={c.always || !hidden.has(k)} disabled={c.always}
                          onChange={(e) => onPrefs({ ...prefs, hidden: e.target.checked ? [...hidden].filter((x) => x !== k) : [...hidden, k] })} />
                        {c.label}
                      </label>
                      <button type="button" className="ui-icon-btn" aria-label={`Move ${c.label} up`} disabled={i === 0} onClick={() => move(k, -1)}><ArrowUp size={14} aria-hidden="true" /></button>
                      <button type="button" className="ui-icon-btn" aria-label={`Move ${c.label} down`} disabled={i === order.length - 1} onClick={() => move(k, 1)}><ArrowDown size={14} aria-hidden="true" /></button>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
            <fieldset>
              <legend className="ui-label">Density</legend>
              <div className="flex gap-1" role="radiogroup" aria-label="Density">
                {/* A control, so a button's 8px corners (a pill is a status, not a choice). */}
                {[['comfortable', 'Comfortable'], ['compact', 'Compact']].map(([k, l]) => (
                  <button key={k} type="button" role="radio" aria-checked={(prefs?.density || 'comfortable') === k} className={`ui-btn ui-btn-sm ${(prefs?.density || 'comfortable') === k ? 'ui-btn-soft' : 'ui-btn-ghost'}`} onClick={() => onPrefs({ ...prefs, density: k })}>{l}</button>
                ))}
              </div>
            </fieldset>
            <button type="button" className="ui-link text-sm" onClick={() => onPrefs(defaults || {})}>Reset columns</button>
          </div>
        </Popover>
      ) : null}
    </>
  );
}

export function TablePager({ total, page, pageSize, onPage, onPageSize, noun = 'results' }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);
  const first = Math.max(1, Math.min(page - 2, pages - 4));
  const window5 = Array.from({ length: Math.min(5, pages) }, (_, i) => first + i);
  return (
    <div className="ui-table-pager">
      <span className="ui-caption tabular-nums" aria-live="polite">Showing {from}–{to} of {total} {noun}</span>
      <div className="flex flex-wrap items-center gap-1">
        <select className="ui-select ui-ctl-compact" aria-label="Rows per page" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {SIZES.map((n) => <option key={n} value={n}>{n} per page</option>)}
        </select>
        <button type="button" className="ui-icon-btn" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
        {window5.map((n) => (
          <button key={n} type="button" className={`ui-page-btn tabular-nums ${n === page ? 'is-current' : ''}`} aria-current={n === page ? 'page' : undefined} aria-label={`Page ${n}`} onClick={() => onPage(n)}>{n}</button>
        ))}
        <button type="button" className="ui-icon-btn" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={16} aria-hidden="true" /></button>
      </div>
    </div>
  );
}

export default function DataTable({
  columns, rows, rowKey = (r) => r.id, label = 'Results',
  sort = null, onSort, prefs = {}, onPrefs = null,
  selectable = false, selected = new Set(), onSelect, canSelect = null,
  rowActions = null, onRowClick = null, card = null,
  loading = false, refreshing = false, empty = null,
  total = 0, page = 1, pageSize = 25, onPage, onPageSize, noun = 'results', toolbar = null, tabs = null, defaultPrefs = {},
  rowLabel = null,
}) {
  /* What a row's menu and tick box are named after: its own words, never a database id (#80 QA: "Actions for cmv…" on Branches). */
  const nameOf = (r, id) => (rowLabel && rowLabel(r)) || r.name || r.employeeName || r.branchName || r.managerName || r.title || r.label || r.code || id;
  const cols = visibleColumns(columns, prefs);
  const compact = prefs?.density === 'compact';
  const choosable = (r) => !canSelect || canSelect(r) !== false;
  const ids = rows.filter(choosable).map(rowKey);
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
  const someOn = !allOn && ids.some((id) => selected.has(id));
  const headBox = useRef(null);
  useEffect(() => { if (headBox.current) headBox.current.indeterminate = someOn; }, [someOn]);
  const toggle = (id) => { const next = new Set(selected); if (next.has(id)) next.delete(id); else next.add(id); onSelect?.(next); };
  const togglePage = () => { const next = new Set(selected); for (const id of ids) { if (allOn) next.delete(id); else next.add(id); } onSelect?.(next); };
  const sortBy = (c) => {
    if (!c.sortable || !onSort) return;
    onSort(sort?.key === c.key && sort.dir === 'asc' ? { key: c.key, dir: 'desc' } : { key: c.key, dir: 'asc' });
  };
  const open = (e, row) => {
    if (!onRowClick) return;
    if (e.target.closest('button, a, input, select, label, [role="menu"]')) return;
    onRowClick(row);
  };

  return (
    <div className={`ui-datatable ${compact ? 'is-compact' : ''} ${card ? 'has-cards' : ''}`} aria-busy={loading || refreshing || undefined}>
      {toolbar || onPrefs || tabs ? (
        <div className="ui-datatable-toolbar">
          {/* The list's own tabs (status, In use / Retired) start the search row instead of taking a row of their own (owner, 28 Oct 2026). */}
          {tabs ? <div className="ui-datatable-tabs">{tabs}</div> : null}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
          {refreshing ? <span className="ui-caption inline-flex items-center gap-1" role="status"><RefreshCw size={12} aria-hidden="true" className="ui-spin" /> Updating</span> : null}
          {onPrefs ? <ColumnSettings columns={columns} prefs={prefs} onPrefs={onPrefs} defaults={defaultPrefs} /> : null}
        </div>
      ) : null}
      {/* With nothing to show, the box is only as tall as its header, so the empty message sits right under it. */}
      <div className={`ui-table-scroll ui-datatable-desktop ${!loading && !rows.length ? 'ui-table-fit' : ''}`}>
        <table className="ui-table w-full" aria-label={label}>
          <thead>
            <tr>
              {selectable ? <th scope="col" className="w-10"><input ref={headBox} type="checkbox" className="ui-checkbox" aria-label="Choose every row on this page" checked={allOn} onChange={togglePage} disabled={!rows.length} /></th> : null}
              {cols.map((c) => (
                <th key={c.key} scope="col" style={c.width ? { width: c.width } : undefined} className={c.align === 'right' ? 'text-right ui-num' : c.align === 'center' ? 'text-center' : ''}
                  aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : c.sortable ? 'none' : undefined}>
                  {c.sortable && onSort ? (
                    <button type="button" className="ui-th-sort" onClick={() => sortBy(c)}>
                      {c.label}
                      {sort?.key === c.key ? (sort.dir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />) : null}
                    </button>
                  ) : c.label}
                </th>
              ))}
              {rowActions ? <th scope="col" className="w-12"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody className="ui-rows">
            {loading ? Array.from({ length: 6 }, (_, i) => (
              <tr key={`sk${i}`} aria-hidden="true">
                {selectable ? <td /> : null}
                {cols.map((c) => <td key={c.key}><span className="ui-skel ui-skel-text" /></td>)}
                {rowActions ? <td /> : null}
              </tr>
            )) : rows.map((r) => {
              const id = rowKey(r);
              return (
                <tr key={id} className={`${onRowClick ? 'ui-row-click' : ''} ${selected.has(id) ? 'is-selected' : ''}`} onClick={(e) => open(e, r)}>
                  {selectable ? <td className="w-10">{choosable(r) ? <input type="checkbox" className="ui-checkbox" aria-label={`Choose ${nameOf(r, id)}`} checked={selected.has(id)} onChange={() => toggle(id)} /> : null}</td> : null}
                  {cols.map((c, i) => (
                    <td key={c.key} className={c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center' : ''}>
                      {i === 0 && onRowClick ? (
                        <button type="button" className="ui-row-open" onClick={() => onRowClick(r)}>{c.render ? c.render(r) : r[c.key] ?? '—'}</button>
                      ) : c.render ? c.render(r) : (r[c.key] ?? '—')}
                    </td>
                  ))}
                  {rowActions ? <td className="w-12 text-right">{(() => { const items = rowActions(r).filter(Boolean); return items.length ? <RowMenu label={`Actions for ${nameOf(r, id)}`} items={items} /> : null; })()}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {card ? (
        <ul className="ui-datatable-cards" aria-label={label}>
          {loading ? Array.from({ length: 4 }, (_, i) => <li key={`sk${i}`} className="ui-datatable-card" aria-hidden="true"><span className="ui-skel ui-skel-text" /></li>) : rows.map((r) => {
            const id = rowKey(r);
            return (
              <li key={id} className={`ui-datatable-card ${selected.has(id) ? 'is-selected' : ''}`}>
                {/* A 44px tap target around the tick box (#80 QA: 24px on a phone), its footprint unchanged. */}
                {selectable && choosable(r) ? <label className="ui-card-check-hit"><input type="checkbox" className="ui-checkbox ui-card-check" aria-label={`Choose ${nameOf(r, id)}`} checked={selected.has(id)} onChange={() => toggle(id)} /></label> : null}
                {/* A card opens the record only when there is one to open; otherwise it is plain content, not a stop for Tab. */}
                {onRowClick ? <button type="button" className="ui-card-open" onClick={() => onRowClick(r)}>{card(r)}</button> : <div className="w-full min-w-0">{card(r)}</div>}
                {rowActions ? (() => { const items = rowActions(r).filter(Boolean); return items.length ? <RowMenu label={`Actions for ${nameOf(r, id)}`} items={items} /> : null; })() : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {/* A page past the end (rows were removed, or an old link) is not "nothing here": the rows are on an earlier page. */}
      {!loading && !rows.length && total > 0 && page > 1 && onPage ? (
        <div className="flex flex-wrap items-center gap-3 py-6">
          <span className="text-sm">This page is empty.</span>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => onPage(Math.max(1, Math.ceil(total / pageSize)))}>Go to the last page</button>
        </div>
      ) : !loading && !rows.length ? empty : null}
      {!loading && total > 0 && onPage ? <TablePager total={total} page={page} pageSize={pageSize} onPage={onPage} onPageSize={onPageSize} noun={noun} /> : null}
    </div>
  );
}
