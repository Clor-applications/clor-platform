import React, { useMemo, useRef, useState } from 'react';
import { Download, FileText, Search, Table2 } from 'lucide-react';

import { downloadCsv } from '../utils/csv';
import { consumeSearchSeed } from '../utils/searchSeed';
import { notify } from './ui/notify';
import { singularise } from './ui/Primitives';
import Popover from './ui/Popover';
import { LIST_PERIODS, describeView } from '../utils/listPeriod';
import { exportListPdf } from '../utils/listPdf';
import { exportListXlsx } from '../utils/listXlsx';

/**
 * The three things every list page owes the user: search across the row, a
 * per-column filter row (see ColumnFilters) and an export of what is on
 * screen. This is the search + export half; pair it with <ColumnHeader /> cells in the
 * table head.
 *
 * Export always writes the *filtered* rows, so what you see is what you get.
 */
export function ListToolbar({
  search,
  onSearch,
  placeholder = 'Search…',
  onExport,
  exportLabel = 'Export',
  count,
  countLabel = 'rows',
  children,
  className = '',
  // Period presets. Supplied by lists that have a date to filter on; a list
  // without one simply does not pass them and the control does not appear.
  period = null,
  onPeriodChange = null,
  dateFrom = '',
  dateTo = '',
  onDateFromChange = null,
  onDateToChange = null,
  // When a column set and rows are given, Export offers PDF, Excel and CSV
  // rather than only writing a CSV. `onExport` remains for the screens that
  // build something bespoke.
  exportColumns = null,
  exportRows = null,
  exportTitle = '',
  exportFileName = '',
  exportSheetName = '',
}) {
  const exportBtnRef = useRef(null);
  const [exportOpen, setExportOpen] = useState(false);
  const richExport = Array.isArray(exportColumns) && exportColumns.length && Array.isArray(exportRows);
  const subtitle = describeView({ period: period || 'all', dateFrom, dateTo, search });

  return (
    <div className={`ui-card p-3 flex flex-wrap items-center gap-3 ${className}`}>
      <div className="relative flex-1 min-w-[220px]">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 ui-muted" aria-hidden="true" />
        <input
          type="text"
          value={search ?? ''}
          onChange={(e) => onSearch?.(e.target.value)}
          className="ui-input w-full pl-9 pr-3 py-2"
          placeholder={placeholder}
          aria-label={placeholder}
        />
      </div>

      {onPeriodChange ? (
        <select
          value={period || 'all'}
          onChange={(e) => onPeriodChange(e.target.value)}
          className="ui-select w-40"
          aria-label="Period"
        >
          {LIST_PERIODS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      ) : null}

      {/* The date boxes exist only for a custom range: beside a preset they
          invite editing one and wondering why the dropdown disagrees. */}
      {onPeriodChange && period === 'custom' ? (
        <>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange?.(e.target.value)}
            className="ui-input w-36"
            aria-label="From date"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => onDateToChange?.(e.target.value)}
            className="ui-input w-36"
            aria-label="To date"
          />
        </>
      ) : null}

      {children}

      {Number.isFinite(count) ? (
        <div className="text-xs ui-muted whitespace-nowrap">
          {count} {count === 1 ? singularise(countLabel) : countLabel}
        </div>
      ) : null}

      {richExport ? (
        <div className="relative">
          <button
            type="button"
            ref={exportBtnRef}
            onClick={() => setExportOpen((v) => !v)}
            className="ui-btn ui-btn-secondary whitespace-nowrap"
            aria-haspopup="menu"
            aria-expanded={exportOpen}
          >
            <Download size={16} aria-hidden="true" /> {exportLabel}
          </button>
          {exportOpen ? (
            <Popover anchorRef={exportBtnRef} onClose={() => setExportOpen(false)} minWidth={220}>
              <div className="py-1" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExportOpen(false);
                    exportListPdf({
                      title: exportTitle || exportLabel,
                      subtitle,
                      fileName: exportFileName || 'export',
                      columns: exportColumns,
                      rows: exportRows,
                      footNote: `${exportRows.length} row(s) · exported from CLOR`,
                    });
                  }}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm hover:bg-[rgb(var(--surface-sunken))]"
                >
                  <FileText size={16} aria-hidden="true" /> PDF
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExportOpen(false);
                    exportListXlsx({
                      subtitle,
                      fileName: exportFileName || 'export',
                      sheetName: exportSheetName || exportTitle || 'Export',
                      columns: exportColumns,
                      rows: exportRows,
                    });
                  }}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm hover:bg-[rgb(var(--surface-sunken))]"
                >
                  <Table2 size={16} aria-hidden="true" /> Excel
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExportOpen(false);
                    if (onExport) onExport();
                    else exportRows({ fileName: exportFileName || 'export', columns: exportColumns, rows: exportRows });
                  }}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm hover:bg-[rgb(var(--surface-sunken))]"
                >
                  <Download size={16} aria-hidden="true" /> CSV
                </button>
                <p className="ui-caption px-3 pt-1 pb-2">
                  Exports what you are looking at — this period, this search, these columns.
                </p>
              </div>
            </Popover>
          ) : null}
        </div>
      ) : onExport ? (
        <button type="button" onClick={onExport} className="ui-btn ui-btn-secondary whitespace-nowrap">
          <Download size={16} aria-hidden="true" /> {exportLabel}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Free-text search over chosen fields of each row.
 * `fields` is a list of accessors (function or key name).
 */
export function useListSearch(rows, fields = [], seedKey = '') {
  // A list opened from the command palette arrives filtered to the record that
  // was chosen. Consumed once, so navigating back later shows the whole list.
  const [query, setQuery] = useState(() => (seedKey ? consumeSearchSeed(seedKey) : ''));

  const filtered = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return Array.isArray(rows) ? rows : [];
    return (Array.isArray(rows) ? rows : []).filter((row) =>
      fields.some((f) => {
        const v = typeof f === 'function' ? f(row) : row?.[f];
        return String(v ?? '').toLowerCase().includes(q);
      })
    );
    // fields is normally an inline array; depending on it would rebuild every
    // render, so the row list and the query are what matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query]);

  return { query, setQuery, filtered };
}

/** Export helper that reports an empty view instead of writing a header-only file. */
export function exportRows({ fileName, columns, rows, label = 'rows', prefixRows = [], footerRows = [] }) {
  if (!Array.isArray(rows) || !rows.length) {
    notify.error('Nothing to export in the current view.');
    return;
  }
  downloadCsv({ fileName, columns, rows, prefixRows, footerRows });
  notify.success(`${rows.length} ${label} exported.`);
}

export default ListToolbar;
