import { getNumberingVoucherDef, getVoucherSeries, nextFreeVoucherNumber } from '../utils/docSettings';

export default function VoucherSeriesSelect({ db, setDb, currentCompany, voucherKey, branchId = null, onNumberChange, onSelect, className = '' }) {
  if (!db || !setDb || !currentCompany || !voucherKey) return null;
  const choices = getVoucherSeries(currentCompany, voucherKey).filter((series) => series.isActive);
  if (!choices.length) return null;
  const activeId = currentCompany.docSettings?.activeNumberingSeries?.[voucherKey];
  const selectedId = choices.some((series) => series.id === activeId) ? activeId : choices[0].id;
  const choose = (seriesId) => {
    const company = { ...currentCompany, docSettings: { ...(currentCompany.docSettings || {}), activeNumberingSeries: { ...(currentCompany.docSettings?.activeNumberingSeries || {}), [voucherKey]: seriesId } } };
    const listKey = getNumberingVoucherDef(voucherKey)?.listKey;
    const takenNumbers = listKey ? (db[listKey] || []).filter((document) => document.companyId === currentCompany.id).map((document) => String(document.number || '').trim()) : [];
    const nextNumber = nextFreeVoucherNumber({ db, company, voucherKey, branchId, takenNumbers });
    setDb((old) => ({ ...old, companies: old.companies.map((item) => item.id === currentCompany.id ? { ...item, docSettings: { ...(item.docSettings || {}), activeNumberingSeries: { ...(item.docSettings?.activeNumberingSeries || {}), [voucherKey]: seriesId } } } : item) }));
    onNumberChange?.(nextNumber);
    onSelect?.(seriesId);
  };
  return <label className={`flex min-w-0 items-center gap-2 text-xs font-medium ${className}`}><span className="shrink-0">Series</span><select className="ui-select ui-ctl-compact w-40 max-w-[32vw]" aria-label={`${getNumberingVoucherDef(voucherKey)?.label || 'Document'} number series`} value={selectedId} onChange={(event) => choose(event.target.value)}>{choices.map((series) => <option key={series.id} value={series.id}>{series.name}</option>)}</select></label>;
}
