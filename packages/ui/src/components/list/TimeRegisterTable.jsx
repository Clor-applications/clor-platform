import React, { Children, cloneElement, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { currentUser, orgId } from '@platform/context';
import { Columns3 } from '../ui/lineIcons';
import Popover from '../ui/Popover';
import { usePeoplePageSlot } from './PeoplePageLayout';

const desktop = () => window.matchMedia('(min-width: 768px)');
const subscribe = (fn) => {
  const query = desktop();
  query.addEventListener('change', fn);
  return () => query.removeEventListener('change', fn);
};

// Native registers have domain-specific cells, column filters and totals. Apply
// one visibility mask to every row, including totals that span several columns.
function filterRow(row, visibility, fields) {
  if (row.type !== 'tr') return row;
  let start = 0;
  return cloneElement(row, {}, Children.toArray(row.props.children).flatMap(cell => {
    const span = Number(cell.props.colSpan || 1);
    const label = fields[start]?.label;
    const visible = visibility.slice(start, start + span).filter(Boolean).length;
    start += span;
    if (!visible) return [];
    if (span > 1) return [cloneElement(cell, { colSpan: visible })];
    return [label && cell.type === 'td' ? cloneElement(cell, { 'data-field-label': label }) : cell];
  }));
}

function ConfigurableTable({ register, required = [], defaultHidden = [], mobileFields, children, className, ...props }) {
  const [slot, layout] = usePeoplePageSlot('table');
  const wide = useSyncExternalStore(subscribe, () => desktop().matches, () => true);
  const configurable = wide || Boolean(mobileFields);
  const key = 'clor:time-columns:' + [orgId(), currentUser()?.id || 'session', register, wide ? 'table' : 'cards'].join(':');
  const read = () => {
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
  };
  const [saved, setSaved] = useState(() => ({ key, value: read() }));
  if (saved.key !== key) setSaved({ key, value: read() });
  const choices = saved.value;
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const sections = Children.toArray(children);
  const header = sections.find(s => s.type === 'thead');
  const fields = Children.toArray(Children.only(header.props.children).props.children).map(cell => {
    const label = cell.props.label || (typeof cell.props.children === 'string' ? cell.props.children : null);
    return { label, optional: Boolean(label && !required.includes(label)), secondary: defaultHidden.includes(label) };
  });
  const visibility = fields.map(f => !configurable || !f.optional || (choices[f.label] ?? (wide ? !f.secondary : mobileFields.includes(f.label))));
  function save(next) {
    setSaved({ key, value: next });
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Preferences are optional. */ }
  }
  const control = configurable && fields.some(f => f.optional) && <>
    <button ref={anchor} type="button" className="ui-btn ui-btn-secondary ui-columns-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Columns3 size={16} aria-hidden="true" /> Columns
    </button>
    {open && <Popover anchorRef={anchor} onClose={() => setOpen(false)} align="end" minWidth={220}>
      <fieldset className="p-3" aria-label="Columns">
        <legend className="sr-only">Columns</legend>
        {fields.map((f, i) => f.label && <label key={f.label} className="flex items-center gap-2 py-1.5 text-sm">
          <input type="checkbox" className="ui-checkbox" checked={visibility[i]} disabled={!f.optional}
            onChange={e => save({ ...choices, [f.label]: e.target.checked })} />{f.label}
        </label>)}
        <button type="button" className="ui-link mt-2 text-sm" onClick={() => save({})}>Reset columns</button>
      </fieldset>
    </Popover>}
  </>;
  return <>
    {layout?.columnsTarget ? createPortal(control, layout.columnsTarget) : control}
    <table {...props} ref={slot} className={!wide && mobileFields ? 'time-record-cards' : className} data-time-register={register} data-time-cards={!wide && mobileFields ? true : undefined}>
      {sections.map(s => ['thead', 'tbody', 'tfoot'].includes(s.type) && configurable
        ? cloneElement(s, {}, Children.map(s.props.children, row => row && filterRow(row, visibility, fields))) : s)}
    </table>
  </>;
}

export default function TimeRegisterTable({ enabled, register, required, defaultHidden, mobileFields, ...table }) {
  return enabled ? <ConfigurableTable key={register} register={register} required={required} defaultHidden={defaultHidden} mobileFields={mobileFields} {...table} /> : <table {...table} />;
}
