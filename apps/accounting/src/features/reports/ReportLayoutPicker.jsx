import React, { useState } from 'react';
import { ChevronDown, Search, SlidersHorizontal } from 'lucide-react';

// The saved-layout menu and editor follow the Sales Invoice Register layout control.
export default function ReportLayoutPicker({ title, columns, defaultKeys, selectedKeys, onSelect, storageKey, onOpen }) {
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState(null);
  const [search, setSearch] = useState('');
  const [dragged, setDragged] = useState('');
  const [dragTarget, setDragTarget] = useState('');
  const [after, setAfter] = useState(false);
  const [saved, setSaved] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]').filter(layout => Array.isArray(layout.columns)); }
    catch { return []; }
  });
  const [active, setActive] = useState('default');
  const available = new Set(columns.map(column => column.key));
  const compatible = saved.map(layout => ({ ...layout, compatibleColumns: layout.columns.filter(key => available.has(key)) })).filter(layout => layout.compatibleColumns.length);
  const choose = (keys, id) => { onSelect(keys); setActive(id); setOpen(false); };
  const edit = (layout) => {
    setEditor({ id: layout?.id || `layout-${Date.now()}`, name: layout?.name || 'New layout', columns: layout?.compatibleColumns || [...selectedKeys], isNew: !layout });
    setSearch(''); setOpen(false);
  };
  const save = () => {
    if (!editor?.columns.length) return;
    const layout = { id: editor.id, name: editor.name.trim() || 'Custom layout', columns: editor.columns };
    const next = editor.isNew ? [...saved, layout] : saved.map(item => item.id === layout.id ? layout : item);
    setSaved(next); localStorage.setItem(storageKey, JSON.stringify(next));
    choose(layout.columns, layout.id); setEditor(null);
  };
  const drop = (key) => {
    if (dragged && dragged !== key) setEditor(current => {
      const next = current.columns.filter(item => item !== dragged);
      next.splice(next.indexOf(key) + (after ? 1 : 0), 0, dragged);
      return { ...current, columns: next };
    });
    setDragged(''); setDragTarget(''); setAfter(false);
  };
  return <div className="relative">
    <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => { onOpen?.(); setOpen(value => !value); }}><SlidersHorizontal size={14}/> Layout <ChevronDown size={13}/></button>
    {open && <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-xl border ui-border-c bg-[rgb(var(--surface))] p-2 shadow-xl">
      <div className="px-2 pb-2 pt-1 text-xs font-bold uppercase tracking-wide ui-muted">Saved layouts</div>
      <button type="button" className={`report-layout-choice ${active === 'default' ? 'is-active' : ''}`} onClick={() => choose(defaultKeys, 'default')}><span><strong>Default layout</strong><small>Essential report columns</small></span><span aria-hidden="true">{active === 'default' ? '✓' : ''}</span></button>
      {compatible.map(layout => <div key={layout.id} className={`report-layout-choice ${active === layout.id ? 'is-active' : ''}`}><button type="button" className="min-w-0 flex-1 text-left" onClick={() => choose(layout.compatibleColumns, layout.id)}><strong className="block truncate">{layout.name}</strong><small>{layout.compatibleColumns.length} compatible column{layout.compatibleColumns.length === 1 ? '' : 's'}</small></button><button type="button" className="ui-link px-2" onClick={() => edit(layout)}>Edit</button></div>)}
      <div className="mt-2 border-t ui-border-c pt-2"><button type="button" className="ui-btn ui-btn-primary ui-btn-sm w-full" onClick={() => edit(null)}>+ Create new layout</button></div>
    </div>}
    {editor && <div className="fixed inset-0 z-[100] flex items-center justify-center ui-scrim p-3 sm:p-5" role="dialog" aria-modal="true" aria-label="Customize Layout" onPointerDown={event => { if (event.target === event.currentTarget) setEditor(null); }}><div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border ui-border-c bg-[rgb(var(--surface))] shadow-2xl sm:max-h-[calc(100dvh-2.5rem)]">
      <div className="flex flex-none items-start justify-between gap-4 border-b ui-border-c px-5 py-3"><div className="min-w-0"><h3 className="text-xl font-bold text-[rgb(var(--fg))]">Customize Layout</h3><p className="truncate text-sm ui-muted">Choose and arrange the columns to display in the {title}.</p></div><div className="flex flex-none items-center gap-2"><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setEditor(null)}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={!editor.columns.length} onClick={save}>Save</button></div></div>
      <div className="min-h-0 flex-1 overflow-y-auto"><div className="border-b ui-border-c px-5 py-3"><label className="block max-w-sm"><span className="mb-1 block text-sm font-semibold">Layout name</span><input className="ui-input h-9 w-full text-sm" value={editor.name} onChange={event => setEditor(current => ({ ...current, name: event.target.value }))}/></label></div>
        <div className="grid grid-cols-[230px_1fr] gap-4 p-4"><section className="rounded-lg border ui-border-c p-3"><div className="relative mb-3"><Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 ui-muted"/><input className="ui-input h-9 w-full ps-9 text-sm" placeholder="Search columns…" value={search} onChange={event => setSearch(event.target.value)}/></div><h4 className="mb-2 text-sm font-bold">Available Columns</h4><div className="max-h-72 space-y-1 overflow-y-auto">{columns.filter(column => column.label.toLowerCase().includes(search.toLowerCase())).map(column => <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm ui-hover-sunken"><input type="checkbox" className="ui-checkbox" checked={editor.columns.includes(column.key)} onChange={() => setEditor(current => ({ ...current, columns: current.columns.includes(column.key) ? current.columns.filter(key => key !== column.key) : [...current.columns, column.key] }))}/>{column.label}</label>)}</div></section>
          <section className="rounded-lg border ui-border-c p-3"><div className="mb-3 flex items-center justify-between"><h4 className="text-sm font-bold">Selected Columns <span className="font-normal ui-muted">(drag to reorder)</span></h4><button type="button" className="ui-link text-sm" onClick={() => setEditor(current => ({ ...current, columns: [...defaultKeys] }))}>Reset to Default</button></div><div className="overflow-hidden rounded-lg border ui-border-c">{editor.columns.map(key => { const column = columns.find(item => item.key === key); if (!column) return null; return <div key={key} draggable onDragStart={event => { setDragged(key); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', key); }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; const rect = event.currentTarget.getBoundingClientRect(); setAfter(event.clientY > rect.top + rect.height / 2); setDragTarget(key); }} onDragLeave={() => setDragTarget(current => current === key ? '' : current)} onDrop={event => { event.preventDefault(); drop(key); }} onDragEnd={() => { setDragged(''); setDragTarget(''); setAfter(false); }} className={`report-layout-drag-row ${dragged === key ? 'is-dragging' : ''} ${dragTarget === key && dragged !== key ? (after ? 'is-drop-target-after' : 'is-drop-target') : ''}`}><span className="report-layout-drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span><span className="min-w-0 flex-1 font-medium">{column.label}</span><span className="text-sm ui-muted">Show</span><button type="button" className="ui-icon-btn h-7 w-7" onClick={() => setEditor(current => ({ ...current, columns: current.columns.filter(item => item !== key) }))} aria-label={`Remove ${column.label}`}>×</button></div>; })}</div></section></div>
      </div>
    </div></div>}
  </div>;
}
