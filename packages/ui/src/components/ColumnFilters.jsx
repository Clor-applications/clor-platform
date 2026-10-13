import React, { useMemo, useRef, useState } from 'react';
import { ChevronDown, Search as SearchIcon } from 'lucide-react';
import { useDismissable } from './ui/useDismissable';

/**
 * Column filters, the way a spreadsheet does them.
 *
 * Each header carries a control that opens a panel with: sort ascending or
 * descending, a condition (contains / equals / greater than…), a search box,
 * and a checklist of the values actually present in that column. A column with
 * anything active shows it, so a list that looks empty always explains itself.
 *
 * Usage:
 *   const cf = useColumnFilters();
 *   const rows = cf.apply(allRows, { number: (r) => r.number, date: (r) => r.date });
 *   …
 *   <thead>
 *     <tr>
 *       <ColumnHeader label="No." col="number" state={cf} />
 *       <th>Actions</th>
 *   </thead>
 */

const CONDITIONS = [
  { id: '', label: 'Choose One' },
  { id: 'contains', label: 'Contains' },
  { id: 'notContains', label: 'Does not contain' },
  { id: 'equals', label: 'Equals' },
  { id: 'notEquals', label: 'Does not equal' },
  { id: 'startsWith', label: 'Begins with' },
  { id: 'endsWith', label: 'Ends with' },
  { id: 'gt', label: 'Greater than' },
  { id: 'lt', label: 'Less than' },
  { id: 'empty', label: 'Is empty' },
  { id: 'notEmpty', label: 'Is not empty' },
];

const TEXT_CONDITIONS = CONDITIONS.filter((condition) => !['gt', 'lt'].includes(condition.id));
const NUMBER_CONDITIONS = CONDITIONS.filter((condition) => ['', 'equals', 'notEquals', 'gt', 'lt', 'empty', 'notEmpty'].includes(condition.id));

const asText = (v) => String(v ?? '').trim();

/** Numeric when both sides look numeric — so 100 sorts after 9, not before. */
const compareValues = (a, b) => {
  const na = Number(String(a).replace(/[^0-9.-]/g, ''));
  const nb = Number(String(b).replace(/[^0-9.-]/g, ''));
  const bothNumeric = String(a).trim() !== '' && String(b).trim() !== '' && Number.isFinite(na) && Number.isFinite(nb);
  if (bothNumeric) return na - nb;
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
};

/**
 * A date column filters by window, not by operator.
 *
 * The text conditions can express one bound — "greater than 2026-09-01" — but
 * never both at once, and a person looking at a list of dates wants the month,
 * not an inequality. Dates reach here as ISO (yyyy-mm-dd), which compares
 * correctly as text, so the window is a string comparison and needs no parsing.
 */
const rangeMatches = (cellText, { from, to }) => {
  const cell = asText(cellText).slice(0, 10);
  if (!from && !to) return true;
  /* A row with no date is not inside any window. */
  if (!cell) return false;
  if (from && cell < asText(from)) return false;
  if (to && cell > asText(to)) return false;
  return true;
};

const conditionMatches = (cellText, { op, value }) => {
  if (!op) return true;
  const cell = asText(cellText);
  const needle = asText(value);
  if (op === 'empty') return cell === '';
  if (op === 'notEmpty') return cell !== '';
  if (needle === '') return true;

  const c = cell.toLowerCase();
  const n = needle.toLowerCase();
  if (op === 'contains') return c.includes(n);
  if (op === 'notContains') return !c.includes(n);
  if (op === 'equals') return c === n;
  if (op === 'notEquals') return c !== n;
  if (op === 'startsWith') return c.startsWith(n);
  if (op === 'endsWith') return c.endsWith(n);
  if (op === 'gt') return compareValues(cell, needle) > 0;
  if (op === 'lt') return compareValues(cell, needle) < 0;
  return true;
};

export function useColumnFilters() {
  // key -> { values: string[] | null, op: string, value: string }
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState(null); // { key, dir: 'asc' | 'desc' }
  // Which column's panel is open — shared, so opening one closes the others.
  const [openKey, setOpenKey] = useState(null);

  // What the table was last given, so a filter panel can list the values that
  // exist in its column without every page having to hand them over.
  const source = useRef({ rows: [], extractors: {} });

  const setColumn = (key, patch) =>
    setFilters((prev) => {
      const next = { ...prev };
      const merged = { ...(prev[key] || { values: null, op: '', value: '', from: '', to: '' }), ...patch };
      const inert =
        merged.values === null &&
        !merged.op &&
        asText(merged.value) === '' &&
        asText(merged.from) === '' &&
        asText(merged.to) === '';
      if (inert) delete next[key];
      else next[key] = merged;
      return next;
    });

  const clearColumn = (key) =>
    setFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });

  const clearAll = () => {
    setFilters({});
    setSort(null);
    setOpenKey(null);
  };

  const textOf = (row, key) => {
    const extract = source.current.extractors?.[key];
    if (!extract) return '';
    return asText(typeof extract === 'function' ? extract(row) : row?.[extract]);
  };

  /** Distinct values present in a column, before that column's own filter. */
  const valuesFor = (key) => {
    const { rows, extractors } = source.current;
    const others = Object.entries(filters).filter(([k]) => k !== key);
    const pool = (Array.isArray(rows) ? rows : []).filter((row) =>
      others.every(([k, f]) => {
        const cell = asText(extractors?.[k] ? extractors[k](row) : '');
        if (Array.isArray(f.values) && !f.values.includes(cell)) return false;
        return rangeMatches(cell, f) && conditionMatches(cell, f);
      })
    );
    const seen = new Set();
    for (const row of pool) seen.add(textOf(row, key));
    return [...seen].sort(compareValues);
  };

  const apply = (rows, extractors) => {
    source.current = { rows: Array.isArray(rows) ? rows : [], extractors: extractors || {} };

    const active = Object.entries(filters);
    let out = Array.isArray(rows) ? rows : [];

    if (active.length) {
      out = out.filter((row) =>
        active.every(([key, f]) => {
          const cell = asText(extractors?.[key] ? extractors[key](row) : '');
          if (Array.isArray(f.values) && !f.values.includes(cell)) return false;
          return rangeMatches(cell, f) && conditionMatches(cell, f);
        })
      );
    }

    if (sort?.key && extractors?.[sort.key]) {
      out = [...out].sort((a, b) => {
        const d = compareValues(textOf(a, sort.key), textOf(b, sort.key));
        return sort.dir === 'desc' ? -d : d;
      });
    }

    return out;
  };

  return {
    filters,
    sort,
    setSort,
    openKey,
    setOpenKey,
    setColumn,
    clearColumn,
    clearAll,
    valuesFor,
    apply,
    // Kept so existing callers keep working while pages migrate.
    applyFilters: apply,
    setFilter: (key, value) => setColumn(key, { op: asText(value) ? 'contains' : '', value }),
    hasActiveFilters: Object.keys(filters).length > 0 || Boolean(sort),
  };
}

/** The panel itself — rendered fixed so a scrolling table cannot clip it. */
const FilterPanel = ({ column, state, anchorRect, onClose }) => {
  const key = column.key;
  const current = state.filters[key] || { values: null, op: '', value: '', from: '', to: '' };
  const isDate = column.type === 'date';
  const isNumber = column.type === 'number';
  const isChoice = column.type === 'choice';
  const all = useMemo(() => state.valuesFor(key), [state, key]);

  const [search, setSearch] = useState('');
  const [checked, setChecked] = useState(() => (current.values === null ? new Set(all) : new Set(current.values)));
  const [op, setOp] = useState(current.op || '');
  const [value, setValue] = useState(current.value || '');
  const [from, setFrom] = useState(current.from || '');
  const [to, setTo] = useState(current.to || '');
  const panelRef = useRef(null);

  /* Outside click and Escape, through the shared hook — the panel exists only
     while it is open, so `open` is simply true here. Its ref is the panel
     itself rather than a wrapper: the column header that opened it is in the
     table, nowhere near this, and the header owns its own toggle. */
  useDismissable(true, onClose, panelRef);

  const displayValue = (raw) => {
    if (!isNumber || raw === '') return raw;
    const number = Number(raw);
    return Number.isFinite(number)
      ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(number)
      : raw;
  };
  const displayTextValue = (raw) => (isNumber || isDate ? displayValue(raw) : String(raw || ''));
  const shown = search.trim()
    ? all.filter((v) => `${v} ${displayValue(v)}`.toLowerCase().includes(search.trim().toLowerCase()))
    : all;
  const allShownChecked = shown.length > 0 && shown.every((v) => checked.has(v));
  const dateTree = useMemo(() => {
    if (!isDate) return [];
    const years = new Map();
    shown.forEach((iso) => {
      const [year = '(blank)', month = '', day = ''] = String(iso || '').slice(0, 10).split('-');
      if (!years.has(year)) years.set(year, new Map());
      const months = years.get(year);
      if (!months.has(month)) months.set(month, []);
      months.get(month).push({ iso, day });
    });
    return [...years.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [isDate, shown]);

  const toggle = (v) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  const applyNow = () => {
    const everything = checked.size === all.length;
    state.setColumn(key, {
      values: everything ? null : [...checked],
      op,
      value,
      from,
      to,
    });
    onClose();
  };

  const clearNow = () => {
    state.clearColumn(key);
    onClose();
  };

  /*
   * Under the heading, or over it — whichever there is room for.
   *
   * This used to place itself at `min(anchorBottom + 6, viewportHeight - 460)`:
   * a fixed 460px reservation, subtracted whether the panel needed it or not.
   * On a laptop with a toolbar, or any table more than half-way down the page,
   * that second term won and the panel was pulled UP over the column headings
   * it belongs to — covering the very filters somebody was reading.
   *
   * So: below when below fits, above when it does not, and never taller than
   * the gap it ends up in. The list of values inside scrolls instead.
   */
  const GAP = 6;
  const MARGIN = 8;
  const viewportH = typeof window === 'undefined' ? 800 : window.innerHeight;
  const viewportW = typeof window === 'undefined' ? 1200 : window.innerWidth;

  const below = viewportH - (anchorRect?.bottom || 0) - GAP - MARGIN;
  const above = (anchorRect?.top || 0) - GAP - MARGIN;
  /* Below unless it is both too tight AND worse than the space above. */
  const placeAbove = below < 260 && above > below;
  const maxHeight = Math.max(200, placeAbove ? above : below);
  const top = placeAbove
    ? Math.max(MARGIN, (anchorRect?.top || 0) - GAP - maxHeight)
    : Math.max(MARGIN, (anchorRect?.bottom || 0) + GAP);
  const left = Math.min(Math.max(MARGIN, (anchorRect?.left || 0) - MARGIN), viewportW - 352);

  return (
    <div
      ref={panelRef}
      className="fixed flex w-[21.5rem] flex-col overflow-hidden ui-surface border rounded-md shadow-lg p-2 gap-1 text-xs"
      style={{ top, left, maxHeight, zIndex: 'var(--z-popover)' }}
      role="dialog"
      aria-label={`Filter ${column.label || key}`}
    >
      <div className="border-b pb-1" style={{ borderColor: 'rgb(var(--border))' }}>
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => {
              state.setSort({ key, dir: 'asc' });
              onClose();
            }}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs ui-hover-sunken ${state.sort?.key === key && state.sort?.dir === 'asc' ? 'ui-sunken' : ''}`}
          >
            <span className="w-5 text-center font-medium ui-muted" aria-hidden="true">A↓</span>
            {isDate ? 'Sort Oldest to Newest' : isNumber ? 'Sort Smallest to Largest' : 'Sort A to Z'}
          </button>
          <button
            type="button"
            onClick={() => {
              state.setSort({ key, dir: 'desc' });
              onClose();
            }}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs ui-hover-sunken ${state.sort?.key === key && state.sort?.dir === 'desc' ? 'ui-sunken' : ''}`}
          >
            <span className="w-5 text-center font-medium ui-muted" aria-hidden="true">Z↓</span>
            {isDate ? 'Sort Newest to Oldest' : isNumber ? 'Sort Largest to Smallest' : 'Sort Z to A'}
          </button>
        </div>
      </div>

      <details className="border-b py-1" style={{ borderColor: 'rgb(var(--border))' }}>
        <summary className="flex cursor-pointer list-none items-center justify-between rounded px-2 py-1.5 text-xs ui-hover-sunken">
          <span>{isDate ? 'Date Filters' : isNumber ? 'Number Filters' : isChoice ? 'Select Values' : 'Text Filters'}</span>
          <span aria-hidden="true">›</span>
        </summary>
        <div className="px-2 pb-2 pt-1">
        {isDate ? (
          /* The window this column used to need a page-wide band for. */
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="ui-input min-w-0 flex-1 px-2 text-xs ui-ctl-compact"
              aria-label={`${column.label || key} from`}
            />
            <span className="ui-subtle">–</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="ui-input min-w-0 flex-1 px-2 text-xs ui-ctl-compact"
              aria-label={`${column.label || key} to`}
            />
          </div>
        ) : isChoice ? null : (
        <div className="flex gap-2">
          <select value={op} onChange={(e) => setOp(e.target.value)} className="ui-select flex-1 px-2 text-xs ui-ctl-compact">
            {(isNumber ? NUMBER_CONDITIONS : TEXT_CONDITIONS).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!op || op === 'empty' || op === 'notEmpty'}
            className="ui-input w-24 px-2 text-xs ui-ctl-compact"
            placeholder="Value"
            aria-label="Condition value"
          />
        </div>
        )}
        </div>
      </details>

      <button
        type="button"
        onClick={clearNow}
        disabled={!state.filters[key] && state.sort?.key !== key}
        className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs ui-hover-sunken disabled:opacity-40"
      >
        <span className="w-5 text-center" aria-hidden="true">⌫</span>
        Clear Filter From “{column.label || key}”
        <span className="sr-only">Clear Filter</span>
      </button>

      <div className="relative mt-1">
        <SearchIcon size={14} className="absolute left-2 top-1/2 -translate-y-1/2 ui-muted" aria-hidden="true" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ui-input w-full pl-7 pr-2 text-xs ui-ctl-compact"
          placeholder="Search (All)"
          aria-label="Search values"
        />
      </div>

      {/* The one part that grows without limit, so it is the part that
          scrolls — the sort buttons and the footer stay reachable. */}
      <div className="min-h-52 flex-1 min-w-0 overflow-y-auto border p-2 space-y-1">
        <label className="flex items-center gap-2 cursor-pointer font-medium">
          <input
            type="checkbox"
            className="ui-checkbox"
            checked={allShownChecked}
            onChange={(e) =>
              setChecked((prev) => {
                const next = new Set(prev);
                shown.forEach((v) => (e.target.checked ? next.add(v) : next.delete(v)));
                return next;
              })
            }
          />
          (Select All)
        </label>
        {shown.length === 0 ? <div className="ui-muted text-xs px-1">No values</div> : null}
        {isDate ? dateTree.map(([year, months]) => (
          <details key={year} open className="rounded-md">
            <summary className="cursor-pointer font-medium">{year}</summary>
            <div className="pl-3 space-y-1">
              {[...months.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([month, days]) => (
                <details key={`${year}-${month}`}>
                  <summary className="cursor-pointer">{month ? new Date(`${year}-${month}-01T00:00:00`).toLocaleString(undefined, { month: 'long' }) : '(blank)'}</summary>
                  <div className="pl-3 space-y-1">
                    {days.map(({ iso, day }) => (
                      <label key={iso || '(blank)'} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" className="ui-checkbox" checked={checked.has(iso)} onChange={() => toggle(iso)} />
                        <span>{day || '(blank)'}</span>
                      </label>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </details>
        )) : shown.map((v) => (
          <label key={v || '(blank)'} className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="ui-checkbox" checked={checked.has(v)} onChange={() => toggle(v)} />
            <span className="truncate">{v === '' ? '(Blank)' : displayTextValue(v)}</span>
          </label>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="ui-btn ui-btn-secondary ui-btn-sm text-xs">
          Cancel
        </button>
        <button type="button" onClick={applyNow} className="ui-btn ui-btn-primary ui-btn-sm text-xs">
          OK<span className="sr-only">Apply Filter</span>
        </button>
      </div>
    </div>
  );
};

/**
 * A header cell that carries its own filter, the way a spreadsheet does: the
 * label stays put and a caret on the right opens the panel. No second row.
 */
export const ColumnHeader = ({ label, col, state, className = '', align = 'left', type = 'text', onResizeStart }) => {
  const [rect, setRect] = useState(null);
  const [localOpen, setLocalOpen] = useState(false);
  const shared = typeof state?.setOpenKey === 'function';
  const open = shared ? state.openKey === col : localOpen;
  const active = col ? state?.filters?.[col] : null;
  const sorted = col && state?.sort?.key === col;

  const close = () => {
    if (shared) state.setOpenKey(null);
    else setLocalOpen(false);
  };

  /*
   * The alignment goes on the <th>, where the column can inherit it.
   *
   * `align` positions the label inside the control, which is why a centred
   * header looks centred. It does not touch the cells: those take their
   * alignment from `ui-col-h-<align>` on the header, via the column-geometry
   * rules in index.css. Without the class the prop is declared at two dozen
   * call sites and silently does nothing — every date and status column read
   * as centred in the source and left-aligned on screen.
   */
  const headClass = `ui-col-h-${align} ${className}`.trim();

  if (!col) {
    return <th scope="col" className={headClass}>{label}</th>;
  }

  /* `relative` positions the resize handle below; `headClass` carries the
     column's alignment, which every cell under it follows. */
  return (
    <th scope="col" className={`relative ${headClass}`}>
      <button
        type="button"
        onClick={(e) => {
          setRect(e.currentTarget.getBoundingClientRect());
          if (shared) state.setOpenKey(open ? null : col);
          else setLocalOpen(!open);
        }}
        /* Tall enough to hit. The control was the height of its own text —
           16px inside a 33px header cell — so half the header was dead to
           the pointer and the whole of it was under the 24px a pointer
           target is meant to be. `-my-1.5` gives the padding back to the cell
           so no row gets taller. */
        className={`report-column-heading-button w-full flex items-center gap-1 ${align === 'right' ? 'justify-end' : 'justify-between'} py-1.5 -my-1.5`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Sort and filter ${typeof label === 'string' ? label : col}`}
      >
        {/* A centred column centres its LABEL over the values, not the
            label-plus-chevron unit — that put "Date" half a chevron left of
            every date under it. An invisible mirror of the icon group on the
            other side keeps the label on the column's axis whatever the icon
            group happens to be showing. */}
        {align === 'center' ? (
          <span className="flex items-center gap-0.5 shrink-0 invisible" aria-hidden="true">
            {sorted ? <span className="text-xs">{state.sort.dir === 'asc' ? '\u25b2' : '\u25bc'}</span> : null}
            <ChevronDown size={14} />
          </span>
        ) : null}
        {/* Not truncated: a column somebody has dragged narrower should cut at
            the cell edge, not resolve to an ellipsis the drag cannot undo. */}
        <span className="whitespace-nowrap">{label}</span>
        <span className="flex items-center gap-0.5 shrink-0">
          {sorted ? <span aria-hidden="true" className="text-xs">{state.sort.dir === 'asc' ? '\u25b2' : '\u25bc'}</span> : null}
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={active ? 'text-[rgb(var(--brand))]' : 'opacity-50'}
          />
        </span>
      </button>

      {onResizeStart ? <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${typeof label === 'string' ? label : col} column`}
        className="report-column-resizer"
        onPointerDown={(event) => onResizeStart(event, col)}
        onClick={(event) => event.stopPropagation()}
      /> : null}

      {open && rect ? (
        <FilterPanel
          column={{ key: col, label: typeof label === 'string' ? label : col, type }}
          state={state}
          anchorRect={rect}
          onClose={close}
        />
      ) : null}
    </th>
  );
};

export default ColumnHeader;
