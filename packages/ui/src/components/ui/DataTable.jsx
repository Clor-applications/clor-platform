import { currentUser, orgId } from '@platform/context';
import { usePeoplePageSlot } from '../list/PeoplePageLayout';
import { createPortal } from 'react-dom';
import autoAnimate from '@formkit/auto-animate';
import { getCoreRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as ContextMenu from '@radix-ui/react-context-menu';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Pin, ChevronDown, ChevronLeft, ChevronRight, Columns3, MoreVertical, RefreshCw } from '@ui/components/ui/lineIcons';

import Popover from './Popover';
import { LoadingSpinner, loadsWithSpinner } from './Primitives';
import { freshFirst, isTodayDate, opensElsewhere, todayInIndia } from '../../picks/round57';

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
 * - Below 640px rows become cards: `card(row)` draws one. With `tiles`, wider
 *   screens show the cards as a grid of tiles too (outside Books, picks.css).
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

/*
 * Row actions as words in the row (owner's pick, 17 Nov 2026): up to three actions show as text buttons,
 * so each row says what can be done to it. More than three, and in Books, they stay behind the ⋮ menu.
 */
const inBooks = () => typeof document !== 'undefined' && document.documentElement.dataset.palette === 'indigo';

function RowMenu({ label, items, compact }) {
  if (!compact && items.length && !inBooks()) {
    return (
      <span className="ui-row-words" role="group" aria-label={label}>
        {items.slice(0, 1).map((it) => (
          <button key={it.key} type="button" disabled={it.disabled} data-write={it.write || it.danger || undefined} className={`ui-row-word ${it.danger ? 'is-danger' : ''}`}
            onClick={(e) => { e.stopPropagation(); it.onSelect(); }}>
            {it.label}
          </button>
        ))}
        {items.length > 1 && <RowMenuButton label={label} items={items.slice(1)} />}
      </span>
    );
  }
  return <RowMenuButton label={label} items={items} />;
}

function RowMenuButton({ label, items }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const list = useRef(null);
  const onKey = (e) => {
    const all = [...(list.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || [])];
    const i = all.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };
  return (
    <>
      <button ref={btn} type="button" className="ui-icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <MoreVertical size={16} aria-hidden="true" />
      </button>
      {open ? (
        <Popover anchorRef={btn} onClose={() => setOpen(false)} minWidth={180} maxWidth={260}>
          <div ref={list} role="menu" aria-label={label} className="ui-menu" onKeyDown={onKey}>
            {items.map((it, i) => (
              /* The Popover hands the caret to [data-autofocus] once it is placed; focusing earlier is lost to the hidden panel. */
              <button key={it.key} type="button" role="menuitem" disabled={it.disabled} data-write={it.write || it.danger || undefined} data-autofocus={i === items.findIndex((x) => !x.disabled) ? '' : undefined} className={`ui-menu-item ${it.danger ? 'is-danger' : ''}`}
                onClick={(e) => { e.stopPropagation(); setOpen(false); it.onSelect(); }}>
                {it.label}
              </button>
            ))}
          </div>
        </Popover>
      ) : null}
    </>
  );
}

export function ColumnSettings({ columns, prefs, onPrefs, defaults }) {
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
                      <button type="button" className="ui-icon-btn" aria-label={`Pin ${c.label}`} aria-pressed={prefs.pinned === k}
                        onClick={() => onPrefs({ ...prefs, pinned: prefs.pinned === k ? false : k })}><Pin size={13} /></button>
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
    <div className="ui-table-pager" data-single-page={pages === 1 && total <= SIZES[0] && page === 1 || undefined}>
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

/* emptycell A: a box with nothing in it reads as a calm grey dash, never a blank. */
const isBlank = (v) => v == null || v === '' || v === false;
function cellOf(c, r) {
  const v = c.render ? c.render(r) : r[c.key];
  return isBlank(v) ? <span className="ui-empty-cell"><span aria-hidden="true">—</span><span className="sr-only">Not added</span></span> : v;
}

function useWindowedList(items, ref, enabled, estimate, rowKey) {
  const windowed = useVirtualizer({
    count: items.length, enabled, getScrollElement: () => ref.current,
    getItemKey: (i) => rowKey(items[i]), estimateSize: () => estimate, overscan: 8,
  });
  const visible = enabled ? windowed.getVirtualItems() : [];
  return {
    items: enabled ? visible.map((entry) => items[entry.index]) : items,
    start: visible[0]?.start || 0,
    end: visible.length ? windowed.getTotalSize() - visible[visible.length - 1].end : 0,
    scrollTo: enabled ? (index) => windowed.scrollToIndex(index, { align: 'auto' }) : null,
    measure: enabled ? windowed.measureElement : undefined,
    offset: visible[0]?.index || 0,
  };
}

function RowContext({ children, actions }) {
  if (!actions?.length) return children;
  return <ContextMenu.Root modal={false}>
    <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
    <ContextMenu.Portal><ContextMenu.Content className="ui-menu" style={{ zIndex: 'var(--z-popover, 60)' }}>
      {actions.map((item) => <ContextMenu.Item asChild key={item.key} className={`ui-menu-item ${item.danger ? 'is-danger' : ''}`}
        disabled={item.disabled} onSelect={item.onSelect}>
        <button type="button" disabled={item.disabled} data-write={item.write || item.danger || undefined}>{item.label}</button>
      </ContextMenu.Item>)}
    </ContextMenu.Content></ContextMenu.Portal>
  </ContextMenu.Root>;
}

export default function DataTable({
  columns, rows, rowKey = (r) => r.id, label = 'Results',
  sort = null, onSort, prefs: suppliedPrefs, onPrefs: savePrefs = null,
  selectable = false, selected = new Set(), onSelect, canSelect = null,
  rowActions = null, compactActions = false, onRowClick = null, card = null, cardActions = null,
  loading = false, refreshing = false, empty = null,
  total = 0, page = 1, pageSize = 25, onPage, onPageSize, noun = 'results', toolbar = null, tabs = null, defaultPrefs = {},
  rowLabel = null, tiles = false, showSortHint = false, mobileSelectAll = false,
  /* Round 57: the row just added (on top, softly lit), today's row in a dated list, and a record's own address. */
  freshKey = null, rowDate = null, rowHref = null, recordColumn = null, externalColumnSettings = false, columnSettingsTarget: explicitColumnsTarget = null,
}) {
  /* What a row's menu and tick box are named after: its own words, never a database id (#80 QA: "Actions for cmv…" on Branches). */
  const [tableSlot, pageLayout] = usePeoplePageSlot('table', !externalColumnSettings && !explicitColumnsTarget);
  // A table with its own search or tabs already has a toolbar.
  const columnSettingsTarget = explicitColumnsTarget || (!toolbar && !tabs ? pageLayout?.columnsTarget : null);
  const nameOf = (r, id) => (rowLabel && rowLabel(r)) || r.name || r.employeeName || r.branchName || r.managerName || r.title || r.label || r.code || id;
  const view = new URLSearchParams(window.location.search);
  const key = `clor:table-prefs:${view.get('app') || 'workspace'}:${view.get('open') || label}:${label}:${orgId()}:${currentUser()?.id || 'session'}`;
  const readPrefs = () => {
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
  };
  const [saved, setLocal] = useState(() => ({ key, value: readPrefs() }));
  if (saved.key !== key) setLocal({ key, value: readPrefs() });
  const local = saved.value;
  const prefs = { ...defaultPrefs, ...local, ...suppliedPrefs };
  const onPrefs = (next) => {
    setLocal({ key, value: next });
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* no storage */ }
    savePrefs?.(next);
  };
  const updateSetting = (name, fn) => onPrefs({ ...prefs, [name]: typeof fn === 'function' ? fn(prefs[name] || (name === 'sorting' ? [] : {})) : fn });
  const definitions = useMemo(() => columns.map((col) => ({
    id: col.key, accessorFn: (row) => col.value ? (typeof col.value === 'function' ? col.value(row) : row[col.key]) : row[col.key],
    enableSorting: Boolean(col.sortable), meta: col,
  })), [columns]);
  const data = useMemo(() => freshKey ? freshFirst(rows, freshKey, rowKey) : rows, [rows, freshKey, rowKey]);
  const ordered = visibleColumns(columns, prefs);
  const table = useReactTable({
    data, columns: definitions, getRowId: (row) => String(rowKey(row)),
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
    autoResetPageIndex: false, manualSorting: Boolean(onSort), enableSortingRemoval: false, columnResizeMode: 'onChange',
    defaultColumn: { minSize: 88, maxSize: 480 },
    onColumnSizingChange: (fn) => updateSetting('columnSizing', fn),
    onSortingChange: (fn) => updateSetting('sorting', fn),
    state: {
      columnSizing: prefs.columnSizing || {},
      sorting: prefs.sorting || [],
      columnOrder: ordered.map((col) => col.key),
      columnVisibility: Object.fromEntries(columns.map((col) => [col.key, col.always || !prefs.hidden?.includes(col.key)])),
      ...(onSort ? { sorting: sort ? [{ id: sort.key, desc: sort.dir === 'desc' }] : [] } : {}),
    },
  });
  const leafColumns = table.getVisibleLeafColumns();
  const pinned = prefs.pinned === false ? null : leafColumns.find((col) => col.id === (prefs.pinned || recordColumn)) || leafColumns[0];
  const cols = [...(pinned ? [pinned] : []), ...leafColumns.filter((col) => col !== pinned)].map((col) => col.columnDef.meta);
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
    /* newtab A: Ctrl-click anywhere on a row opens the record in a new tab, like any link. */
    if (rowHref && opensElsewhere(e)) { const href = rowHref(row); if (href) window.open(href, '_blank', 'noopener'); return; }
    onRowClick(row);
  };
  /* The link a row's name is: a plain click opens it here, Ctrl-click, middle-click or a long press leaves it to the browser. */
  const followLink = (e, row) => {
    if (opensElsewhere(e)) return;
    e.preventDefault();
    onRowClick(row);
  };
  const today = rowDate ? todayInIndia() : null;
  const shownRows = table.getRowModel().rows.map((r) => r.original);
  const desktopRef = useRef(null);
  const cardsRef = useRef(null);
  const people = typeof document !== 'undefined' && document.documentElement.dataset.app === 'people';
  const [edges, setEdges] = useState({ before: false, after: false });
  useEffect(() => {
    const viewport = desktopRef.current;
    if (!people || !viewport || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const max = viewport.clientWidth ? viewport.scrollWidth - viewport.clientWidth : 0;
      const before = max > 1 && viewport.scrollLeft > 1;
      const after = max > 1 && viewport.scrollLeft < max - 1;
      setEdges((old) => old.before === before && old.after === after ? old : { before, after });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(viewport.querySelector('table'));
    viewport.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => { observer.disconnect(); viewport.removeEventListener('scroll', measure); };
  }, [people]);
  const scrollColumns = (direction) => {
    const box = desktopRef.current;
    const pinnedWidth = box.querySelector('th[data-pinned]')?.offsetWidth || 0;
    box.scrollBy({ left: direction * Math.max(96, box.clientWidth - pinnedWidth - 48) });
  };
  const large = shownRows.length >= 200 && !loading;
  const desktop = useWindowedList(shownRows, desktopRef, large, compact ? 36 : 48, rowKey);
  const cards = useWindowedList(shownRows, cardsRef, Boolean(card && large && !tiles), 96, rowKey);
  const spacer = (height) => height > 0 && <tr aria-hidden="true"><td colSpan={cols.length + Number(selectable) + Number(Boolean(rowActions))} style={{ padding: 0, border: 0, height }} /></tr>;
  const [activeRowId, setActiveRowId] = useState(null);
  const keyboardRowId = shownRows.some(row => rowKey(row) === activeRowId) ? activeRowId : shownRows.length ? rowKey(shownRows[0]) : null;
  const anchorId = useRef(null);
  const bodyRef = useRef(null);
  useEffect(() => {
    if (large || !bodyRef.current || !window.matchMedia || !Element.prototype.animate) return;
    const controller = autoAnimate(bodyRef.current, { duration: 150, easing: 'ease-in-out' });
    return () => controller.destroy();
  }, [large]);
  const moveInGrid = (e, row, col) => {
    if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.target !== e.currentTarget) return;
    const id = rowKey(row);
    const index = shownRows.indexOf(row);
    if (e.key === ' ' && selectable && choosable(row)) {
      e.preventDefault();
      const start = shownRows.findIndex((item) => rowKey(item) === anchorId.current);
      if (e.shiftKey && start >= 0) {
        const range = shownRows.slice(Math.min(start, index), Math.max(start, index) + 1).filter(choosable);
        onSelect?.(new Set([...selected, ...range.map(rowKey)]));
      } else { toggle(id); anchorId.current = id; }
      return;
    }
    if (e.key === 'Enter' && onRowClick) { e.preventDefault(); onRowClick(row); return; }
    const vertical = { j: 1, k: -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
    const horizontal = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!vertical && !horizontal) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(shownRows.length - 1, index + (vertical || 0)));
    const column = Math.max(0, Math.min(cols.length - 1, col + (horizontal || 0)));
    if (anchorId.current == null) anchorId.current = id;
    desktop.scrollTo?.(next);
    requestAnimationFrame(() => bodyRef.current?.querySelector(`tr[data-index="${next}"] > td[data-column="${CSS.escape(cols[column].key)}"]`)?.focus());
  };
  const rowState = (r, id) => `${freshKey && id === freshKey ? 'is-new' : ''} ${rowDate && isTodayDate(rowDate(r), today) ? 'is-today' : ''}`;
  const todayMark = (r) => (rowDate && isTodayDate(rowDate(r), today) ? <span className="ui-today-chip">Today</span> : null);

  return (
    <div ref={tableSlot} className={`ui-datatable ${compact ? 'is-compact' : ''} ${card ? 'has-cards' : ''} ${card && tiles ? 'is-tiles' : ''}`} aria-busy={loading || refreshing || undefined}>
      {columnSettingsTarget ? createPortal(<ColumnSettings columns={columns} prefs={prefs} onPrefs={onPrefs} defaults={defaultPrefs} />, columnSettingsTarget) : null}
      {toolbar || (!externalColumnSettings && !columnSettingsTarget) || tabs ? (
        <div className="ui-datatable-toolbar" data-columns-only={!toolbar && !tabs && !refreshing || undefined}>
          {/* The list's own tabs (status, In use / Retired) start the search row instead of taking a row of their own (owner, 28 Oct 2026). */}
          {tabs ? <div className="ui-datatable-tabs">{tabs}</div> : null}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
          {refreshing ? <span className="ui-caption inline-flex items-center gap-1" role="status"><RefreshCw size={12} aria-hidden="true" className="ui-spin" /> Updating</span> : null}
          {!externalColumnSettings && !columnSettingsTarget ? <ColumnSettings columns={columns} prefs={prefs} onPrefs={onPrefs} defaults={defaultPrefs} /> : null}
        </div>
      ) : null}
      {/* With nothing to show, the box is only as tall as its header, so the empty message sits right under it. */}
      <div ref={desktopRef} data-virtualized={large || undefined} data-overflow={edges.before || edges.after || undefined} style={large ? { maxHeight: '68vh', overflow: 'auto' } : undefined} className={`ui-table-scroll ui-datatable-desktop ${!loading && !rows.length ? 'ui-table-fit' : ''}`}>
        <table className="ui-table ui-register-grid w-full" style={{ '--selection-w': selectable ? '40px' : '0px' }} aria-label={label}>
          <thead>
            <tr>
              {selectable ? <th scope="col" className="w-10"><input ref={headBox} type="checkbox" className="ui-checkbox" aria-label="Choose every row on this page" checked={allOn} onChange={togglePage} disabled={!ids.length} /></th> : null}
              {cols.map((c) => (
                <th key={c.key} data-column={c.key} data-pinned={c.key === pinned?.id || undefined} scope="col" aria-label={typeof c.label === 'string' ? c.label : undefined} style={{ width: table.getState().columnSizing[c.key] || c.width }} className={c.align === 'right' ? 'text-right ui-num' : c.align === 'center' ? 'text-center' : ''}
                  aria-sort={table.getColumn(c.key).getIsSorted() === 'asc' ? 'ascending' : table.getColumn(c.key).getIsSorted() === 'desc' ? 'descending' : c.sortable ? 'none' : undefined}>
                  {c.sortable ? (
                    <button type="button" className="ui-th-sort" onClick={onSort ? () => sortBy(c) : table.getColumn(c.key).getToggleSortingHandler()}>
                      {c.label}{table.getState().sorting.length > 1 && table.getColumn(c.key).getIsSorted() && <sup>{table.getColumn(c.key).getSortIndex() + 1}</sup>}
                      {table.getColumn(c.key).getIsSorted() ? (table.getColumn(c.key).getIsSorted() === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />) : showSortHint ? <ChevronDown size={14} aria-hidden="true" /> : null}
                    </button>
                  ) : c.header || c.label}
                  <span className="ui-col-resize" role="separator" aria-orientation="vertical" aria-label={`Resize ${c.label}`}
                    tabIndex={0} aria-valuemin={88} aria-valuemax={480} aria-valuenow={table.getColumn(c.key).getSize()} onDoubleClick={() => table.setColumnSizing((old) => {
                      const cells = desktopRef.current.querySelectorAll(`[data-column="${CSS.escape(c.key)}"]`);
                      const widths = Array.from(cells, (cell) => {
                        const range = document.createRange(); range.selectNodeContents(cell);
                        return range.getBoundingClientRect().width + 32;
                      });
                      return { ...old, [c.key]: Math.min(480, Math.max(88, ...widths)) };
                    })}
                    onKeyDown={(event) => {
                      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                      event.preventDefault();
                      const size = Math.max(88, Math.min(480, event.currentTarget.parentElement.offsetWidth + (event.key === 'ArrowRight' ? 16 : -16)));
                      table.setColumnSizing((old) => ({ ...old, [c.key]: size }));
                    }}
                    onMouseDown={table.getFlatHeaders().find((h) => h.id === c.key)?.getResizeHandler()}
                    onTouchStart={table.getFlatHeaders().find((h) => h.id === c.key)?.getResizeHandler()} />
                </th>
              ))}
              {rowActions ? <th scope="col" className="ui-row-actions-col"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody ref={bodyRef} className="ui-rows">
            {spacer(desktop.start)}
            {loading && loadsWithSpinner() ? (
              /* In the height of the rows it waits for (44px each, up to a page of six), so nothing jumps when they land. */
              <tr aria-hidden="true"><td colSpan={cols.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)} className="ui-loading-cell" style={{ height: `${Math.min(Math.max(pageSize || 6, 1), 6) * 2.75}rem` }}><LoadingSpinner /></td></tr>
            ) : loading ? Array.from({ length: 6 }, (_, i) => (
              <tr key={`sk${i}`} aria-hidden="true">
                {selectable ? <td /> : null}
                {cols.map((c) => <td key={c.key}><span className="ui-skel ui-skel-text" /></td>)}
                {rowActions ? <td /> : null}
              </tr>
            )) : desktop.items.map((r, index) => {
              const id = rowKey(r);
              return (
                <RowContext key={id} actions={rowActions?.(r)?.filter(Boolean)}>
                <tr data-index={desktop.offset + index} data-focused={id === activeRowId || undefined} ref={desktop.measure} className={`${onRowClick ? 'ui-row-click' : ''} ${selected.has(id) ? 'is-selected' : ''} ${rowState(r, id)}`} onClick={(e) => open(e, r)}>
                  {selectable ? <td className="w-10">{choosable(r) ? <input type="checkbox" className="ui-checkbox" aria-label={`Choose ${nameOf(r, id)}`} checked={selected.has(id)} onChange={() => toggle(id)} /> : null}</td> : null}
                  {cols.map((c, i) => (
                    <td key={c.key} data-column={c.key} data-pinned={c.key === pinned?.id || undefined}
                      tabIndex={keyboardRowId === id && i === 0 ? 0 : -1}
                      onFocus={() => setActiveRowId(id)} onKeyDown={(e) => moveInGrid(e, r, i)} className={c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center' : ''}>
                      {(recordColumn ? c.key === recordColumn : i === 0) && onRowClick && rowHref && rowHref(r) ? (
                        <a href={rowHref(r)} className="ui-row-open" onClick={(e) => followLink(e, r)}>{cellOf(c, r)}{todayMark(r)}</a>
                      ) : (recordColumn ? c.key === recordColumn : i === 0) && onRowClick ? (
                        <button type="button" className="ui-row-open" onClick={() => onRowClick(r)}>{cellOf(c, r)}{todayMark(r)}</button>
                      ) : i === 0 ? <>{cellOf(c, r)}{todayMark(r)}</> : cellOf(c, r)}
                    </td>
                  ))}
                  {rowActions ? <td className="ui-row-actions-col text-right">{(() => { const items = rowActions(r).filter(Boolean); return items.length ? <RowMenu compact={compactActions} label={`Actions for ${nameOf(r, id)}`} items={items} /> : null; })()}</td> : null}
                </tr>
                </RowContext>
              );
            })}
            {spacer(desktop.end)}
          </tbody>
        </table>
      </div>
      {(edges.before || edges.after) && <div className="people-scroll-columns" role="group" aria-label="Scroll table columns">
        <button type="button" className="ui-icon-btn" disabled={!edges.before} aria-label="Previous columns" onClick={() => scrollColumns(-1)}><ChevronLeft size={16} /></button>
        <span>Scroll columns</span>
        <button type="button" className="ui-icon-btn" disabled={!edges.after} aria-label="Next columns" onClick={() => scrollColumns(1)}><ChevronRight size={16} /></button>
      </div>}
      {mobileSelectAll && selectable && card && ids.length > 0 && !loading ? (
        <label className="mobile-page-select">
          <input type="checkbox" className="ui-checkbox" checked={allOn} ref={(box) => { if (box) box.indeterminate = someOn; }} onChange={togglePage} /> Select page
        </label>
      ) : null}
      {card ? (
        <ul ref={cardsRef} style={large && !tiles ? { maxHeight: '68vh', overflow: 'auto' } : undefined} className="ui-datatable-cards"  aria-label={label}>
          {cards.start > 0 && <li aria-hidden="true" style={{ height: cards.start }} />}
          {loading && loadsWithSpinner() ? <li className="ui-datatable-card" aria-hidden="true"><LoadingSpinner /></li> : loading ? Array.from({ length: 4 }, (_, i) => <li key={`sk${i}`} className="ui-datatable-card" aria-hidden="true"><span className="ui-skel ui-skel-text" /></li>) : cards.items.map((r, index) => {
            const id = rowKey(r);
            return (
              <li key={id} data-index={cards.offset + index} ref={cards.measure} className={`ui-datatable-card ${selected.has(id) ? 'is-selected' : ''} ${rowState(r, id)}`}>
                {/* A 44px tap target around the tick box (#80 QA: 24px on a phone), its footprint unchanged. */}
                {selectable && choosable(r) ? <label className="ui-card-check-hit"><input type="checkbox" className="ui-checkbox ui-card-check" aria-label={`Choose ${nameOf(r, id)}`} checked={selected.has(id)} onChange={() => toggle(id)} /></label> : null}
                {/* A card opens the record only when there is one to open; otherwise it is plain content, not a stop for Tab. */}
                {onRowClick && rowHref && rowHref(r) ? <a href={rowHref(r)} className="ui-card-open" onClick={(e) => followLink(e, r)}>{card(r)}{todayMark(r)}</a> : onRowClick ? <button type="button" className="ui-card-open" onClick={() => onRowClick(r)}>{card(r)}{todayMark(r)}</button> : <div className="w-full min-w-0">{card(r)}{todayMark(r)}</div>}
                {cardActions?.(r)}
                {rowActions ? (() => { const items = rowActions(r).filter(Boolean); return items.length ? <RowMenu compact label={`Actions for ${nameOf(r, id)}`} items={items} /> : null; })() : null}
              </li>
            );
          })}
          {cards.end > 0 && <li aria-hidden="true" style={{ height: cards.end }} />}
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
