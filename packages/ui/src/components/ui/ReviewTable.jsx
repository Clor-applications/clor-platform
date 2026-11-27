import { createPortal } from 'react-dom';
import { motion as Motion, useReducedMotion } from 'motion/react';
import React, { useState } from 'react';
import DataTable from './DataTable';

const idOf = (row) => row.id;

/** Selection belongs to the current result page. A refresh may remove a selected record. */
export function useReviewSelection(rows, rowKey = idOf, scope = null) {
  const [chosen, setChosen] = useState(() => new Set());
  const [focused, setFocused] = useState(false);
  const selectedRows = rows.filter((row) => chosen.has(rowKey(row)));
  const selected = new Set(selectedRows.map(rowKey));
  const [previousScope, setPreviousScope] = useState(scope);
  if (previousScope !== scope) {
    setPreviousScope(scope);
    setChosen(new Set());
    setFocused(false);
  } else if (selected.size < chosen.size) {
    setChosen(selected);
    if (!selected.size) setFocused(false);
  }
  const setSelected = (next) => {
    setChosen(next);
    if (!next.size) setFocused(false);
  };
  return { selected, setSelected, selectedRows, focused: focused && selected.size > 0, setFocused };
}

export function SelectionBar({ selection, onExport }) {
  const { selected, selectedRows, focused, setSelected, setFocused } = selection;
  const reduced = useReducedMotion();
  if (!selected.size) return null;
  return createPortal(<Motion.div initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.15 }} className="ui-bulkbar ui-selection-float" role="group" aria-label="Selected records">
    <strong className="tabular-nums" role="status">{selected.size} selected</strong>
    <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-pressed={focused} onClick={() => setFocused(!focused)}>{focused ? 'Show all rows' : 'Show selected'}</button>
    {onExport ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => onExport(selectedRows)}>Export selected</button> : null}
    <button type="button" className="ui-link text-sm" onClick={() => setSelected(new Set())}>Clear selection</button>
  </Motion.div>, document.body);
}

export function PageCheckbox({ rows, selection }) {
  const every = rows.length > 0 && rows.every((r) => selection.selected.has(r.id));
  const partial = !every && selection.selected.size > 0;
  return <input type="checkbox" className="ui-checkbox" aria-label="Choose every row on this page" checked={every} disabled={!rows.length}
    ref={(el) => { if (el) el.indeterminate = partial; }}
    onChange={() => selection.setSelected(new Set(every ? [] : rows.map((r) => r.id)))} />;
}

export function MobilePageCheckbox({ rows, selection }) {
  if (!rows.length) return null;
  return <label className="mobile-page-select"><PageCheckbox rows={rows} selection={selection} /> Select page</label>;
}

export function RowCheckbox({ row, selection, label = row.employeeName, phoneSlot = 'act' }) {
  const checked = selection.selected.has(row.id);
  return <td className="record-checkbox" data-phone={phoneSlot} onClick={(e) => e.stopPropagation()}>
    <label><input type="checkbox" className="ui-checkbox" aria-label={`Choose ${label}`} checked={checked}
      onChange={() => {
        const next = new Set(selection.selected);
        if (checked) next.delete(row.id); else next.add(row.id);
        selection.setSelected(next);
      }} /></label>
  </td>;
}

/** Add a local shortlist to record lists without introducing bulk write permissions. */
export default function ReviewTable({ rows, rowKey = idOf, exportSelected, ...props }) {
  const selection = useReviewSelection(rows, rowKey);
  return <>
    <SelectionBar selection={selection} onExport={exportSelected} />
    <DataTable {...props} rows={selection.focused ? selection.selectedRows : rows} rowKey={rowKey}
      mobileSelectAll onPage={selection.focused ? undefined : props.onPage} selectable
      selected={selection.selected} onSelect={selection.setSelected} />
  </>;
}
