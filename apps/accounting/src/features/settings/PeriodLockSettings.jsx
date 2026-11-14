import React, { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { listUsers } from '../../api/admin';
import { getPeriodLockPolicy, savePeriodLockPolicy } from '../../api/periodLock';
import { hasApiSession } from '@ui/api/purchaseDocs';
import { notify } from '@ui/components/ui/notify';
import { defaultPeriodLockPolicy, PERIOD_MODULES, periodLockThrough, policyForCompany } from '@ui/utils/periodLock';
import { fyOptions } from '@ui/utils/bookClose';
import { fyNameFor, setBookLockOnServer } from '@ui/utils/bookLockSync';
import { getFiscalYears } from '@ui/api/ledger';
import { useFeatures } from '@ui/permissions/useFeatures';
import { orgId as platformOrgId } from '@platform/context';

const editablePolicy = (value) => {
  const policy = value || defaultPeriodLockPolicy();
  if (!policy.exemptUserIds?.length) return policy;
  return { ...policy, exemptUserIds: [], modules: Object.fromEntries(PERIOD_MODULES.map(([key]) => [key, { ...defaultPeriodLockPolicy().modules[key], ...policy.modules?.[key], exemptUserIds: [...new Set([...(policy.modules?.[key]?.exemptUserIds || []), ...policy.exemptUserIds])] }])) };
};

export default function PeriodLockSettings({ db, setDb, currentCompany }) {
  const companyId = currentCompany?.id;
  const { isEnabled: featureEnabled, loading: featureLoading } = useFeatures();
  const periodLockEnabled = !featureLoading && featureEnabled('periodLock');
  const [policy, setPolicy] = useState(() => editablePolicy(policyForCompany(db, companyId)));
  const [users, setUsers] = useState([]);
  const [usersError, setUsersError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exceptionModule, setExceptionModule] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [fyDrafts, setFyDrafts] = useState({});
  const [fySaving, setFySaving] = useState('');
  const [fyLoadError, setFyLoadError] = useState('');

  const financialYears = useMemo(() => {
    const collections = ['invoices', 'bills', 'expenses', 'creditNotes', 'debitNotes', 'journalEntries', 'payments', 'receipts', 'stockAdjustments', 'stockTransfers', 'bankTransactions'];
    const yearsWithData = new Set(collections.flatMap((key) => Array.isArray(db?.[key]) ? db[key] : []).filter((row) => Number(row?.companyId) === Number(companyId) && row?.date).map((row) => fyNameFor(row.date)));
    return fyOptions(db, companyId).filter((year) => yearsWithData.has(fyNameFor(year.from))).sort((a, b) => b.year - a.year);
  }, [db, companyId]);

  useEffect(() => {
    let live = true;
    const load = async () => {
      setLoading(true);
      setPolicy(editablePolicy(policyForCompany(db, companyId)));
      if (hasApiSession()) {
        const orgId = String(platformOrgId() || '');
        const [policyResult, usersResult] = await Promise.allSettled([getPeriodLockPolicy(), listUsers(orgId)]);
        if (!live) return;
        if (policyResult.status === 'fulfilled') setPolicy(editablePolicy(policyResult.value.policy));
        else notify.error(`Could not load period locks: ${policyResult.reason?.message || 'Request failed'}`);
        if (usersResult.status === 'fulfilled') { setUsers(usersResult.value.users || []); setUsersError(''); }
        else setUsersError(usersResult.reason?.message || 'Unable to load users.');
      }
      if (live) setLoading(false);
    };
    load();
    return () => { live = false; };
  }, [companyId]);

  useEffect(() => {
    if (!hasApiSession() || !companyId) return;
    let live = true;
    getFiscalYears().then(({ fiscalYears = [] }) => {
      if (!live) return;
      const locks = fiscalYears.filter((year) => year.lockedThrough).map((year) => ({ companyId, fyName: year.name, upTo: String(year.lockedThrough).slice(0, 10) }));
      setDb((prev) => ({ ...prev, fyLocks: [...(prev.fyLocks || []).filter((lock) => Number(lock.companyId) !== Number(companyId)), ...locks] }));
      setFyLoadError('');
    }).catch((error) => { if (live) setFyLoadError(error?.message || 'Financial year locks could not be loaded.'); });
    return () => { live = false; };
  }, [companyId]);

  const saveFinancialYear = async (year, lock) => {
    const name = fyNameFor(year.from);
    const through = lock ? String(fyDrafts[name] || year.to).slice(0, 10) : null;
    if (through && (through < year.from || through > year.to)) { notify.error(`Choose a date within ${year.label}.`); return; }
    setFySaving(name);
    try {
      if (!(await setBookLockOnServer({ fyDate: year.from, lockedThrough: through })).ok) return;
      setDb((prev) => ({ ...prev, fyLocks: [...(prev.fyLocks || []).filter((entry) => Number(entry.companyId) !== Number(companyId) || (entry.fyName || fyNameFor(entry.upTo)) !== name), ...(through ? [{ companyId, fyName: name, upTo: through }] : [])] }));
      notify.success(through ? `${year.label} locked through ${through}.` : `${year.label} reopened.`);
    } finally { setFySaving(''); }
  };

  const updateRule = (key, patch) => setPolicy((prev) => ({ ...prev, modules: { ...prev.modules, [key]: { ...prev.modules[key], ...patch } } }));
  const toggleException = (key, id) => setPolicy((prev) => {
    const rule = prev.modules[key] || defaultPeriodLockPolicy().modules[key];
    const selected = rule.exemptUserIds || [];
    return { ...prev, modules: { ...prev.modules, [key]: { ...rule, exemptUserIds: selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id] } } };
  });

  const save = async () => {
    if (!periodLockEnabled) { notify.error('Enable Period Lock under Features → Organisation first. Once enabled, it cannot be disabled.'); return; }
    if (PERIOD_MODULES.some(([key]) => policy.modules[key]?.enabled && policy.modules[key]?.mode === 'MANUAL' && !/^\d{4}-\d{2}-\d{2}$/.test(policy.modules[key]?.manualThrough || ''))) {
      notify.error('Enter a lock-through date as YYYY-MM-DD for every enabled manual rule.');
      return;
    }
    setSaving(true);
    try {
      const nextPolicy = { ...policy, enabled: true };
      const saved = hasApiSession() ? (await savePeriodLockPolicy(nextPolicy)).policy : nextPolicy;
      setPolicy(saved);
      setDb((prev) => ({ ...prev, periodLockPolicies: [...(prev.periodLockPolicies || []).filter((row) => Number(row.companyId) !== Number(companyId)), { companyId, policy: saved }] }));
      notify.success('Period lock settings saved.');
    } catch (error) {
      notify.error(`Could not save period locks: ${error?.message || 'Request failed'}`);
    } finally { setSaving(false); }
  };

  const shortNames = { sales: 'Sales', purchases: 'Purchases', expenses: 'Expenses', journal: 'Journal', inventory: 'Inventory', cashBank: 'Cash & Bank' };
  const selected = exceptionModule ? policy.modules?.[exceptionModule] || defaultPeriodLockPolicy().modules[exceptionModule] : null;
  return <div className="mx-auto max-w-6xl space-y-3 pb-6">
    {/* The settings page already titles this screen; only the save action sits here. */}
    <div className="flex flex-wrap items-center justify-end gap-3"><button type="button" className="ui-btn ui-btn-primary" disabled={loading || saving || !periodLockEnabled} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button></div>
    {!periodLockEnabled ? <p className="ui-caption">Enable Period Lock under Features → Organisation to save rules. Once enabled, it cannot be disabled.</p> : null}
    <div className="w-full"><table className="w-full table-fixed border-collapse text-sm"><colgroup><col style={{ width: '15%' }} /><col style={{ width: '15%' }} /><col style={{ width: '14%' }} /><col style={{ width: '22%' }} /><col style={{ width: '11%' }} /><col style={{ width: '14%' }} /><col style={{ width: '9%' }} /></colgroup><thead className="bg-[rgb(var(--heading-bg))] text-left text-xs"><tr>{['Module', 'Lock mode', 'Days after close', 'Locked through', 'Status', 'Exception users', 'Action'].map((heading) => <th key={heading} className="border-b ui-border-c px-2 py-2 font-medium">{heading}</th>)}</tr></thead><tbody>{PERIOD_MODULES.map(([key]) => {
      const rule = policy.modules?.[key] || defaultPeriodLockPolicy().modules[key];
      const through = periodLockThrough({ ...policy, enabled: true }, key);
      const exceptions = [...new Set([...(rule.exemptUserIds || []), ...(policy.exemptUserIds || [])])];
      return <tr key={key} className="ui-hover-sunken"><td className="px-2 py-2 font-medium">{shortNames[key]}</td>
        <td className="px-2 py-2"><select aria-label={`${shortNames[key]} lock mode`} className="ui-select w-full min-w-0" value={rule.mode} onChange={(event) => updateRule(key, { mode: event.target.value, enabled: true })}><option value="MANUAL">Manual</option><option value="AUTO">Automatic</option></select></td>
        <td className="px-2 py-2">{rule.mode === 'AUTO' ? <input aria-label={`${shortNames[key]} allowed days`} type="number" min="0" max="365" className="ui-input w-full min-w-0" value={rule.autoDays ?? 0} onChange={(event) => updateRule(key, { autoDays: Number(event.target.value) || 0, enabled: true })} /> : <span className="ui-caption">—</span>}</td>
        <td className="px-2 py-2">{rule.mode === 'MANUAL' ? <input aria-label={`${shortNames[key]} lock through`} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" className="ui-input w-full min-w-0" value={rule.manualThrough || ''} onChange={(event) => updateRule(key, { manualThrough: event.target.value, enabled: true })} /> : <span className="text-xs">{through || '—'}</span>}</td>
        <td className="px-2 py-2 text-xs">{rule.enabled && through ? <span className="font-medium text-[rgb(var(--neg))]">Locked</span> : <span className="ui-caption">Open</span>}</td>
        <td className="px-2 py-2"><button type="button" className="text-xs font-medium text-[rgb(var(--brand-ink))] hover:underline" onClick={() => { setUserSearch(''); setExceptionModule(key); }}>{exceptions.length ? `${exceptions.length} ${exceptions.length === 1 ? 'user' : 'users'}` : 'Add users'}</button></td>
        <td className="px-2 py-2"><button type="button" className="text-xs font-medium text-[rgb(var(--brand-ink))] hover:underline" onClick={() => updateRule(key, { enabled: !rule.enabled })}>{rule.enabled ? 'Unlock' : 'Lock'}</button></td></tr>;
    })}</tbody></table></div>
    <section className="w-full"><div className="px-3 py-3"><h3 className="font-semibold">Financial Year Lock</h3>{fyLoadError ? <p className="mt-1 text-xs text-[rgb(var(--neg))]">{fyLoadError}</p> : null}</div><table className="w-full table-fixed border-collapse text-sm"><thead className="bg-[rgb(var(--heading-bg))] text-left text-xs"><tr>{['Financial Year', 'Period', 'Lock through', 'Status', 'Action'].map((heading) => <th key={heading} className="border-b ui-border-c px-3 py-2 font-medium">{heading}</th>)}</tr></thead><tbody>{financialYears.map((year) => { const name = fyNameFor(year.from); const lock = (db.fyLocks || []).find((entry) => Number(entry.companyId) === Number(companyId) && (entry.fyName || fyNameFor(entry.upTo)) === name); return <tr key={name} className="ui-hover-sunken"><td className="px-3 py-2 font-medium">{year.label}</td><td className="px-3 py-2 ui-caption">{year.from} – {year.to}</td><td className="px-3 py-2"><input type="text" inputMode="numeric" placeholder="YYYY-MM-DD" aria-label={`${year.label} lock through`} min={year.from} max={year.to} value={fyDrafts[name] ?? lock?.upTo ?? year.to} onChange={(event) => setFyDrafts((prev) => ({ ...prev, [name]: event.target.value }))} className="ui-input w-full min-w-0" /></td><td className="px-3 py-2">{lock ? <span className="text-xs font-medium text-[rgb(var(--neg))]">Locked through {lock.upTo}</span> : <span className="ui-caption">Open for audit/posting</span>}</td><td className="px-3 py-2"><div className="flex flex-wrap gap-1"><button type="button" className="text-xs font-medium text-[rgb(var(--brand-ink))] hover:underline disabled:opacity-50" disabled={Boolean(fySaving) || Boolean(fyLoadError)} onClick={() => saveFinancialYear(year, true)}>{lock ? 'Update lock' : 'Lock year'}</button>{lock ? <button type="button" className="text-xs font-medium text-[rgb(var(--brand-ink))] hover:underline disabled:opacity-50" disabled={Boolean(fySaving) || Boolean(fyLoadError)} onClick={() => saveFinancialYear(year, false)}>Reopen</button> : null}</div></td></tr>; })}</tbody></table>{financialYears.length === 0 ? <p className="ui-caption px-3 py-4">No financial years with transactions.</p> : null}</section>
    {exceptionModule ? <div className="fixed inset-0 z-[70] flex justify-end ui-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setExceptionModule(''); }}><div className="flex h-full w-full max-w-md flex-col bg-[rgb(var(--surface))] shadow-xl"><div className="flex items-center justify-between border-b px-5 py-4"><div><h3 className="font-semibold">{shortNames[exceptionModule]} exceptions</h3></div><button type="button" aria-label="Close" className="ui-btn ui-btn-secondary !px-2" onClick={() => setExceptionModule('')}><X size={16} /></button></div><div className="flex-1 overflow-y-auto p-5"><label className="mb-3 flex items-center gap-2"><Search size={15} className="ui-muted" /><input type="search" aria-label="Search exception users" placeholder="Search users" className="ui-input w-full" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} /></label>{users.length ? <div className="space-y-2">{users.filter((user) => user.isActive !== false && `${user.fullName || ''} ${user.email || ''}`.toLowerCase().includes(userSearch.toLowerCase())).map((user) => <label key={user.id} className="flex cursor-pointer items-center gap-3 rounded border ui-border-c px-3 py-2"><input type="checkbox" className="ui-checkbox" checked={selected?.exemptUserIds?.includes(String(user.id)) || policy.exemptUserIds?.includes(String(user.id)) || false} disabled={policy.exemptUserIds?.includes(String(user.id))} onChange={() => toggleException(exceptionModule, String(user.id))} /><span className="min-w-0"><span className="block truncate font-medium">{user.fullName || user.email}</span><span className="block truncate ui-caption">{user.email}</span></span></label>)}</div> : <p className="ui-caption">{usersError || 'No users available.'}</p>}</div><div className="border-t p-4 text-right"><button type="button" className="ui-btn ui-btn-primary" onClick={() => setExceptionModule('')}>Done</button></div></div></div> : null}
  </div>;
}







