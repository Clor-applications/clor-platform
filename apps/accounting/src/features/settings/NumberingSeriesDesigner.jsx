import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, FileText, MoreVertical, Pencil, Plus, Power } from 'lucide-react';
import Drawer from '@ui/components/ui/Drawer';
import { notify } from '@ui/components/ui/notify';
import { NUMBERING_VOUCHER_DEFS, formatVoucherNumberPreview, getVoucherSeries, voucherSeriesFormatKey } from '@ui/utils/docSettings';

const Field = ({ label, children }) => <label className="numbering-field"><span>{label}</span>{children}</label>;
const Toggle = ({ label, checked, onChange }) => <label className="numbering-switch-row"><span><b>{label}</b></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;

export default function NumberingSeriesDesigner({ db, setDb, currentCompany, branches }) {
  const [selectedKey, setSelectedKey] = useState('invoice');
  const [editor, setEditor] = useState(null);
  const [draft, setDraft] = useState(null);
  const [actionMenu, setActionMenu] = useState(null);
  const definition = NUMBERING_VOUCHER_DEFS.find((item) => item.key === selectedKey);
  const label = definition?.label || selectedKey;
  const series = getVoucherSeries(currentCompany, selectedKey).map((item) => item.id === 'default' && !item.nextNumber
    ? { ...item, nextNumber: definition?.listKey ? (db?.[definition.listKey] || []).filter((row) => row.companyId === currentCompany?.id).length + 1 : 1 }
    : item);
  const companyBranches = (Array.isArray(branches) ? branches : db?.branches || []).filter((branch) => !branch?.companyId || String(branch.companyId) === String(currentCompany?.id || ''));
  const branchCode = String(companyBranches[0]?.branchCode || companyBranches[0]?.code || '').trim();
  const preview = (item) => formatVoucherNumberPreview({ ...item, branchCode });
  const patch = (change) => setDraft((old) => ({ ...old, ...change }));
  const updateCompany = (transform) => setDb((old) => ({ ...old, companies: old.companies.map((company) => company.id === currentCompany.id ? { ...company, docSettings: transform(company.docSettings || {}) } : company) }));
  const openEditor = (item) => { setDraft({ ...item }); setEditor(item.id); };
  const create = () => openEditor({ ...series[0], id: 'new', name: '', prefix: `${String(series[0]?.prefix || '').replace(/[\s./_-]+$/g, '')}-S${series.length + 1}-`, nextNumber: 1, isActive: true });
  const close = () => { setEditor(null); setDraft(null); };
  const save = () => {
    if (!String(draft?.name || '').trim()) { notify.error('Enter a series name.'); return; }
    const nextNumber = Number(draft.nextNumber);
    if (!Number.isInteger(nextNumber) || nextNumber < 1) { notify.error('Starting number must be at least 1.'); return; }
    if (series.some((item) => item.id !== editor && voucherSeriesFormatKey(item) === voucherSeriesFormatKey(draft))) {
      notify.error('Use a different prefix, suffix or format so this series cannot duplicate another.');
      return;
    }
    const id = editor === 'new' ? (globalThis.crypto?.randomUUID?.() || `series-${Date.now()}`) : editor;
    const saved = { ...draft, id, name: String(draft.name).trim(), nextNumber, digits: Number(draft.digits) || 0 };
    updateCompany((base) => {
      if (id === 'default') {
        const formatKeys = ['mode', 'enabled', 'prefix', 'suffix', 'digits', 'dateFormat', 'separator', 'resetFrequency', 'includeBranchCode', 'allowManualOverride'];
        const format = Object.fromEntries(formatKeys.map((key) => [key, saved[key]]));
        const numberingByBranch = Object.fromEntries(Object.entries(base.numberingByBranch || {}).map(([branchId, config]) => [branchId, config?.[selectedKey] ? { ...config, [selectedKey]: { ...config[selectedKey], ...format } } : config]));
        return { ...base, numbering: { ...(base.numbering || {}), [selectedKey]: saved }, numberingByBranch };
      }
      const current = Array.isArray(base.numberingSeries?.[selectedKey]) ? base.numberingSeries[selectedKey] : [];
      return { ...base, numberingSeries: { ...(base.numberingSeries || {}), [selectedKey]: editor === 'new' ? [...current, saved] : current.map((item) => item.id === id ? saved : item) } };
    });
    close();
    notify.success(`${saved.name} saved.`);
  };
  const toggleSeries = (item) => {
    if (item.isActive && series.filter((entry) => entry.isActive).length === 1) {
      notify.error('Keep at least one active series for this document type.');
      return;
    }
    updateCompany((base) => {
      const isActive = !item.isActive;
      const next = item.id === 'default'
        ? { ...base, numbering: { ...(base.numbering || {}), [selectedKey]: { ...(base.numbering?.[selectedKey] || {}), isActive } } }
        : { ...base, numberingSeries: { ...(base.numberingSeries || {}), [selectedKey]: (base.numberingSeries?.[selectedKey] || []).map((entry) => entry.id === item.id ? { ...entry, isActive } : entry) } };
      if (!isActive && next.activeNumberingSeries?.[selectedKey] === item.id) {
        const replacement = series.find((entry) => entry.id !== item.id && entry.isActive);
        next.activeNumberingSeries = { ...(next.activeNumberingSeries || {}), [selectedKey]: replacement?.id || 'default' };
      }
      return next;
    });
    setActionMenu(null);
    notify.success(`Series ${item.isActive ? 'deactivated' : 'activated'}.`);
  };

  return <div className="numbering-designer">
    <header className="numbering-titlebar"><h1 className="ui-t-page">Document Numbering</h1></header>
    <div className="numbering-layout">
      <aside className="numbering-types ui-card"><div className="numbering-pane-heading"><b>Document Types</b></div><nav>{NUMBERING_VOUCHER_DEFS.map((item) => <button type="button" key={item.key} data-active={selectedKey === item.key || undefined} onClick={() => { setSelectedKey(item.key); setActionMenu(null); }}><span className="numbering-doc-icon"><FileText size={14} /></span><span><b>{item.label}</b></span><ChevronRight size={14} /></button>)}</nav></aside>
      <main className="numbering-editor ui-card"><div className="numbering-editor-head"><h2 className="ui-t-sec">{label} series</h2><button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={create}><Plus size={15} /> New series</button></div>
        <table className="ui-table numbering-series-table"><thead><tr><th>Series</th><th>Next number</th><th>Format</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{series.map((item) => <tr key={item.id}><td><span className="font-medium">{item.id === 'default' ? 'Default series' : item.name}</span>{item.id === 'default' ? <span className="ui-pill ui-pill-neutral ml-2">Default</span> : null}</td><td>{item.nextNumber || 1}</td><td className="ui-mono text-xs">{preview(item)}</td><td><span className={`ui-pill ${item.isActive ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{item.isActive ? 'Active' : 'Inactive'}</span></td><td><button type="button" className="ui-icon-btn" aria-label={`Actions for ${item.name}`} aria-expanded={actionMenu?.id === item.id} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setActionMenu(actionMenu?.id === item.id ? null : { id: item.id, top: Math.min(rect.bottom + 4, window.innerHeight - 96), right: Math.max(8, window.innerWidth - rect.right) }); }}><MoreVertical size={17} /></button></td></tr>)}</tbody></table>
      </main>
    </div>
    {actionMenu ? createPortal(<><div className="fixed inset-0" style={{ zIndex: 'var(--z-popover)' }} onClick={() => setActionMenu(null)} /><div className="ui-card fixed w-40 p-1 shadow-lg" role="menu" style={{ zIndex: 'calc(var(--z-popover) + 1)', top: actionMenu.top, right: actionMenu.right }}><button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[rgb(var(--surface-sunken))]" onClick={() => { const item = series.find((entry) => entry.id === actionMenu.id); setActionMenu(null); if (item) openEditor(item); }}><Pencil size={14} /> Edit</button><button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[rgb(var(--surface-sunken))]" onClick={() => { const item = series.find((entry) => entry.id === actionMenu.id); if (item) toggleSeries(item); }}><Power size={14} /> {series.find((entry) => entry.id === actionMenu.id)?.isActive ? 'Deactivate' : 'Activate'}</button></div></>, document.body) : null}
    <Drawer open={editor !== null} onClose={close} widthClass="w-[min(38rem,94vw)]" title={editor === 'new' ? `New ${label} series` : `Edit ${label} series`} description="Existing voucher numbers will not change." actions={<><button type="button" className="ui-btn ui-btn-secondary" onClick={close}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" onClick={save}>Save series</button></>}>
      {draft ? <div className="space-y-6"><Field label="Series name"><input className="ui-input" value={draft.name || ''} disabled={editor === 'default'} onChange={(event) => patch({ name: event.target.value })} placeholder="e.g. Export invoices" /></Field><div className="grid grid-cols-2 gap-3"><Field label="Prefix"><input className="ui-input" value={draft.prefix || ''} onChange={(event) => patch({ prefix: event.target.value })} /></Field><Field label="Suffix"><input className="ui-input" value={draft.suffix || ''} onChange={(event) => patch({ suffix: event.target.value })} /></Field><Field label="Starting / next number"><input type="number" min="1" className="ui-input" value={draft.nextNumber || 1} onChange={(event) => patch({ nextNumber: event.target.value })} /></Field><Field label="Number of digits"><select className="ui-select" value={draft.digits || 0} onChange={(event) => patch({ digits: Number(event.target.value) })}><option value="0">No padding</option>{[2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field><Field label="Date format"><select className="ui-select" value={draft.dateFormat || 'none'} onChange={(event) => patch({ dateFormat: event.target.value })}><option value="none">No date</option><option value="yyyy">Year</option><option value="yy">Short year</option><option value="yyyy-mm">Year and month</option><option value="yy-mm">Short year and month</option><option value="fy">Financial year</option></select></Field><Field label="Separator"><select className="ui-select" value={draft.separator ?? '-'} onChange={(event) => patch({ separator: event.target.value })}><option value="-">Hyphen</option><option value="/">Slash</option><option value=".">Dot</option><option value="">None</option></select></Field><Field label="Reset frequency"><select className="ui-select" value={draft.resetFrequency || 'never'} onChange={(event) => patch({ resetFrequency: event.target.value })}><option value="never">Never</option><option value="yearly">Yearly</option><option value="financial-year">Financial year</option><option value="monthly">Monthly</option></select></Field></div><Toggle label="Enable automatic numbering" checked={draft.enabled !== false && draft.mode !== 'manual'} onChange={(checked) => patch({ enabled: checked, mode: checked ? 'auto' : 'manual' })} /><Toggle label="Include branch code" checked={Boolean(draft.includeBranchCode)} onChange={(checked) => patch({ includeBranchCode: checked })} /><Toggle label="Allow manual override" checked={Boolean(draft.allowManualOverride)} onChange={(checked) => patch({ allowManualOverride: checked })} /><div className="ui-card p-3"><span className="ui-muted text-xs">Preview</span><strong className="ui-mono mt-1 block">{preview(draft)}</strong></div></div> : null}
    </Drawer>
  </div>;
}
