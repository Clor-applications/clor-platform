import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Save } from 'lucide-react';
import { apiFetch } from '@platform/http';
import { notify } from '@ui/components/ui/notify';
import { formatPartyCode, partyCodeFormat, PARTY_CODE_COMPONENTS } from '@ui/utils/masterCodes';

const labels = { customer: 'Customer', vendor: 'Vendor' };
const componentLabels = { prefix: 'Prefix', branch: 'Branch code', year: 'Year', sequence: 'Sequence number', suffix: 'Suffix' };
const endpoint = (company) => {
  const orgId = String(company?.profile?.backendCompanyId || '').trim();
  if (!orgId) throw new Error('Select a company before editing code numbering.');
  return `/orgs/${encodeURIComponent(orgId)}/party-code-settings`;
};
const Field = ({ title, children }) => <label className="block min-w-0"><span className="mb-1 block text-xs font-medium text-[rgb(var(--fg-muted))]">{title}</span>{children}</label>;

export default function CodeNumberingSettings({ db, setDb, currentCompany, initialKind = 'customer', embedded = false }) {
  const [kind, setKind] = useState(initialKind);
  const [formats, setFormats] = useState(() => ({ customer: partyCodeFormat(currentCompany, 'customer'), vendor: partyCodeFormat(currentCompany, 'vendor') }));
  const [counters, setCounters] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [nextNumberDraft, setNextNumberDraft] = useState(null);
  const [pendingNextNumber, setPendingNextNumber] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const branches = useMemo(() => (db?.branches || []).filter((row) => String(row.companyId) === String(currentCompany?.id) && row.isActive !== false), [db?.branches, currentCompany?.id]);
  const format = formats[kind];
  const branch = branches.find((row) => String(row.id) === branchId) || branches[0];
  const scope = format.includeBranchCode ? String(branch?.backendBranchId || branch?.id || '') : '';
  const counter = counters.find((row) => row.kind === kind.toUpperCase() && row.branchScope === scope);
  const enteredNextNumber = nextNumberDraft === null ? Number(format.nextNumber) || 1 : Number(nextNumberDraft) || 1;
  const requestedNextNumber = nextNumberDraft !== null || pendingNextNumber ? enteredNextNumber : Math.max(enteredNextNumber, Number(counter?.nextNumber) || 1);
  const usedCodes = new Set([...(db?.customers || []), ...(db?.vendors || [])].filter((row) => String(row.companyId) === String(currentCompany?.id)).map((row) => String(row.code || '')));
  let nextNumber = requestedNextNumber;
  for (let attempt = 0; attempt < 10000 && usedCodes.has(formatPartyCode(format, nextNumber, branch?.branchCode || branch?.code || 'BR')); attempt += 1) nextNumber += 1;
  const preview = formatPartyCode(format, nextNumber, branch?.branchCode || branch?.code || 'BR');
  const order = Array.isArray(format.componentOrder) && format.componentOrder.length === PARTY_CODE_COMPONENTS.length && new Set(format.componentOrder).size === PARTY_CODE_COMPONENTS.length && format.componentOrder.every((part) => PARTY_CODE_COMPONENTS.includes(part)) ? format.componentOrder : PARTY_CODE_COMPONENTS;
  const change = (key, value) => setFormats((previous) => ({ ...previous, [kind]: { ...previous[kind], [key]: value } }));
  const changeDigits = (value) => { setNextNumberDraft(null); setPendingNextNumber(true); setFormats((previous) => { const digits = Number(value); const current = previous[kind]; return { ...previous, [kind]: { ...current, digits, nextNumber: Number(current.nextNumber) >= 10 ** digits ? 1 : current.nextNumber } }; }); };
  const moveComponent = (index, direction) => { const next = [...order]; const target = index + direction; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; change('componentOrder', next); };
  const finishNextNumber = () => { if (nextNumberDraft !== null) { change('nextNumber', Math.max(1, Number(nextNumberDraft) || 1)); setNextNumberDraft(null); setPendingNextNumber(true); } };

  useEffect(() => {
    let cancelled = false;
    setError('');
    setFormats({ customer: partyCodeFormat(currentCompany, 'customer'), vendor: partyCodeFormat(currentCompany, 'vendor') });
    setCounters([]);
    setNextNumberDraft(null);
    setPendingNextNumber(false);
    Promise.resolve().then(() => apiFetch(endpoint(currentCompany), { skipWarehouseHeader: true }))
      .then((result) => { if (cancelled) return; setFormats({ customer: { ...partyCodeFormat(currentCompany, 'customer'), ...(result.partyCodeSettings?.customer || {}) }, vendor: { ...partyCodeFormat(currentCompany, 'vendor'), ...(result.partyCodeSettings?.vendor || {}) } }); setCounters(result.counters || []); })
      .catch((cause) => { if (!cancelled) setError(String(cause?.message || cause)); });
    return () => { cancelled = true; };
  }, [currentCompany?.profile?.backendCompanyId]);

  const save = async () => {
    const clean = { ...format, prefix: String(format.prefix || '').trim().toUpperCase(), suffix: String(format.suffix || '').trim().toUpperCase(), digits: Number(format.digits), nextNumber: nextNumberDraft === null ? Number(format.nextNumber) : Number(nextNumberDraft) };
    if (!/^[A-Z0-9_-]*$/.test(clean.prefix) || !/^[A-Z0-9_-]*$/.test(clean.suffix) || !Number.isInteger(clean.digits) || clean.digits < 1 || clean.digits > 10 || !Number.isInteger(clean.nextNumber) || clean.nextNumber < 1 || String(clean.nextNumber).length > clean.digits || String(nextNumber).length > clean.digits || (preview.match(/\d/g) || []).length > 10) { notify.error('The next number must fit the selected number of digits.'); return; }
    setSaving(true);
    try {
      const result = await apiFetch(endpoint(currentCompany), { method: 'PATCH', body: { kind, format: clean }, skipWarehouseHeader: true });
      setFormats((previous) => ({ ...previous, [kind]: clean }));
      setCounters((previous) => previous.map((row) => row.kind === kind.toUpperCase() ? { ...row, nextNumber: clean.nextNumber } : row));
      setNextNumberDraft(null);
      setPendingNextNumber(false);
      setDb((previous) => ({ ...previous, companies: (previous.companies || []).map((company) => String(company.id) === String(currentCompany.id) ? { ...company, profile: { ...company.profile, partyCodeSettings: result.partyCodeSettings } } : company) }));
      notify.success(`${labels[kind]} numbering saved`);
      setError('');
    } catch (cause) { setError(String(cause?.message || cause)); }
    finally { setSaving(false); }
  };

  return <div className="space-y-2 p-2">
    <header className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[rgb(var(--page-heading-bg))] px-3 py-2">
      <div className="inline-flex max-w-full gap-1 rounded-md bg-[rgb(var(--surface)/0.7)] p-0.5" role="tablist" aria-label="Code type">{['customer', 'vendor'].map((item) => <button type="button" role="tab" aria-selected={kind === item} key={item} className={`flex min-w-24 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm font-semibold ${kind === item ? item === 'customer' ? 'bg-[rgb(var(--info-soft))] text-[rgb(var(--info))]' : 'bg-[rgb(var(--warn-soft))] text-[rgb(var(--warn-ink))]' : 'text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--surface))]'}`} onClick={() => { setNextNumberDraft(null); setPendingNextNumber(false); setKind(item); }}><span className={`h-2 w-2 rounded-full ${item === 'customer' ? 'bg-[rgb(var(--info))]' : 'bg-[rgb(var(--warn))]'}`} />{labels[item]}</button>)}</div>
      <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={saving} onClick={save}><Save size={14} />{saving ? 'Saving…' : 'Save Changes'}</button>
    </header>
    {error && <p role="alert" className="rounded-md bg-[rgb(var(--neg-soft))] px-3 py-2 text-sm text-[rgb(var(--neg))]">{error}</p>}
    <div className={`grid items-start gap-2 ${embedded ? '' : 'md:grid-cols-[minmax(0,1.25fr)_minmax(260px,1fr)]'}`}>
      <div className="space-y-2">
        <section className="ui-card rounded-xl p-3"><h2 className="mb-2 text-sm font-semibold">Code generation</h2><div className="grid gap-2 sm:grid-cols-2">
          <Field title="Mode"><select className="ui-input w-full" value={format.mode} onChange={(event) => change('mode', event.target.value)}><option value="automatic">Automatic numbering</option><option value="manual">Manual code entry</option><option value="override">Automatic with manual override</option></select></Field>
          <Field title="Separator"><select className="ui-input w-full" value={format.separator} onChange={(event) => change('separator', event.target.value)}><option value="-">Hyphen (-)</option><option value="/">Slash (/)</option><option value="_">Underscore (_)</option><option value="">None</option></select></Field>
          <Field title="Prefix"><input className="ui-input w-full" maxLength={12} value={format.prefix} onChange={(event) => change('prefix', event.target.value.toUpperCase())} /></Field>
          <Field title="Suffix"><input className="ui-input w-full" maxLength={12} value={format.suffix} onChange={(event) => change('suffix', event.target.value.toUpperCase())} placeholder="Optional" /></Field>
          <Field title="Number of digits"><select className="ui-input w-full" value={format.digits} onChange={(event) => changeDigits(event.target.value)}>{Array.from({ length: 10 }, (_, index) => index + 1).map((digits) => <option key={digits} value={digits}>{digits} digits</option>)}</select></Field>
          <Field title="Next number"><input className="ui-input w-full font-mono" type="text" inputMode="numeric" maxLength={Number(format.digits) || 1} value={nextNumberDraft === null ? String(format.nextNumber || 1).padStart(Number(format.digits) || 1, '0') : nextNumberDraft} onFocus={(event) => { setNextNumberDraft(String(format.nextNumber || 1)); event.target.select(); }} onChange={(event) => setNextNumberDraft(event.target.value.replace(/\D/g, '').slice(0, Number(format.digits) || 1))} onBlur={finishNextNumber} /></Field>
        </div></section>
        <section className="ui-card rounded-xl px-3 py-2"><h2 className="text-sm font-semibold">Optional components</h2><div className="grid gap-2 sm:grid-cols-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={format.includeBranchCode} onChange={(event) => change('includeBranchCode', event.target.checked)} />Branch code</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={format.includeYear} onChange={(event) => change('includeYear', event.target.checked)} />Year</label></div>{format.includeBranchCode && <Field title="Preview branch"><select className="ui-input w-full" value={branch?.id || ''} onChange={(event) => setBranchId(event.target.value)}>{branches.map((row) => <option key={row.id} value={row.id}>{row.name || row.branchName || row.branchCode}</option>)}</select></Field>}</section>
      </div>
      <aside className="space-y-2">
        <section className="ui-card rounded-xl px-3 py-2"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Next code preview</h2><span className={`flex items-center gap-1 text-xs font-semibold ${kind === 'customer' ? 'text-[rgb(var(--brand-ink))]' : 'text-[rgb(var(--warn-ink))]'}`}><Check size={13} />{labels[kind]}</span></div><div className="break-all py-2 ui-mono text-xl font-medium">{format.mode === 'manual' ? 'Manual entry' : preview}</div></section>
        <section className="ui-card rounded-xl px-3 py-2"><h2 className="mb-1 text-sm font-semibold">Component order</h2><div className="space-y-0.5">{order.map((part, index) => <div key={part} className="flex items-center gap-1.5 rounded bg-[rgb(var(--surface-2))] px-2 py-0.5"><span className="w-4 text-xs text-[rgb(var(--fg-muted))]">{index + 1}</span><span className="min-w-0 flex-1 text-sm">{componentLabels[part]}</span>{((part === 'branch' && !format.includeBranchCode) || (part === 'year' && !format.includeYear) || (part === 'prefix' && !format.prefix) || (part === 'suffix' && !format.suffix)) && <span className="ui-caption">Off</span>}<button type="button" className="ui-icon-btn" aria-label={`Move ${componentLabels[part]} up`} disabled={index === 0} onClick={() => moveComponent(index, -1)}><ArrowUp size={14} /></button><button type="button" className="ui-icon-btn" aria-label={`Move ${componentLabels[part]} down`} disabled={index === order.length - 1} onClick={() => moveComponent(index, 1)}><ArrowDown size={14} /></button></div>)}</div></section>
      </aside>
    </div>
  </div>;
}
