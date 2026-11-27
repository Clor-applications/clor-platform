import { useState } from 'react';
import { Command } from 'cmdk';
import * as Popover from '@radix-ui/react-popover';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { Calendar, Check, ChevronDown } from './lineIcons';
import { popoverZIndex, useOverlayLayer } from './overlayLayer';

function Panel({ children, label }) {
  const layer = useOverlayLayer();
  return <Popover.Portal><Popover.Content aria-label={label} className="ui-filter-panel" align="end" collisionPadding={10} sideOffset={6}
    style={{ zIndex: popoverZIndex(layer) }}>{children}</Popover.Content></Popover.Portal>;
}

export function FacetFilter({ label, options, selected, onChange, counts }) {
  return <Popover.Root>
    <Popover.Trigger className="ui-btn ui-btn-secondary" aria-label={label}>
      {label}{selected.length > 0 && <span className="ui-caption">{selected.length}</span>}<ChevronDown size={14} />
    </Popover.Trigger>
    <Panel label={label}>
      <Command label={label}>
        <Command.Input aria-label={`Search ${label.toLowerCase()}`} placeholder="Search options" className="ui-input w-full" />
        <Command.List className="max-h-64 overflow-y-auto">
          <Command.Empty className="ui-caption">No matches</Command.Empty>
          {options.map((o) => <Command.Item key={o.value} value={o.label} className="ui-menu-item" onSelect={() =>
            onChange(selected.includes(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value])}>
            <span aria-hidden="true" style={{ width: 16 }}>{selected.includes(o.value) && <Check size={15} />}</span>
            <span>{o.label}</span><span className="sr-only">{selected.includes(o.value) ? ', included' : ', excluded'}</span>
            <span className="ml-auto ui-caption tabular-nums">{counts[o.value] || 0}</span>
          </Command.Item>)}
        </Command.List>
      </Command>
      {selected.length > 0 && <button type="button" className="ui-link ui-btn-sm" onClick={() => onChange([])}>Clear selection</button>}
    </Panel>
  </Popover.Root>;
}

const asDate = (s) => s ? new Date(s + 'T12:00:00') : undefined;
const asIso = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');

export function DateRangeFilter({ from, to, max, onChange }) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState();
  return <Popover.Root open={open} onOpenChange={(next) => {
    if (next) setRange({ from: asDate(from), to: asDate(to) });
    setOpen(next);
  }}>
    <Popover.Trigger className="ui-btn ui-btn-secondary"><Calendar size={16} />Date range</Popover.Trigger>
    <Panel label="Date range">
      <DayPicker mode="range" weekStartsOn={1} autoFocus selected={range} defaultMonth={range?.from}
        resetOnSelect onSelect={setRange} disabled={max ? { after: asDate(max) } : undefined} />
      <div className="mt-2 flex justify-end gap-2">
        <Popover.Close className="ui-btn ui-btn-ghost ui-btn-sm">Cancel</Popover.Close>
        <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={!range?.from}
          onClick={() => { onChange(asIso(range.from), asIso(range.to || range.from)); setOpen(false); }}>Apply dates</button>
      </div>
    </Panel>
  </Popover.Root>;
}
