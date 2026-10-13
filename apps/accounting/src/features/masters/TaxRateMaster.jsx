import { useMemo, useState } from 'react';
import { Pencil, RotateCcw, Save } from 'lucide-react';

import { PageHeader, StatusPill } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { TDS_NATURES, resolveRule, ruleReference } from '../tds/ruleMaster';
import { DEFAULT_CONFIG, getTdsConfig } from '@ui/utils/tdsTcs';

const todayIso = () => new Date().toISOString().slice(0, 10);
const rateValue = (value) => Math.max(0, Math.min(100, Number(value) || 0));

export function TdsRatesMaster({ db, setDb, currentCompany }) {
  const companyId = currentCompany?.id;
  const saved = currentCompany?.profile?.taxCompliances?.tds?.rateOverrides || {};
  const ledgers = (db.chartOfAccounts || []).filter((ledger) => ledger.companyId === companyId && ledger.isActive !== false);
  const initialRows = useMemo(() => TDS_NATURES.map((nature) => {
    const rule = resolveRule(nature.code, todayIso());
    const override = saved[nature.code] || {};
    return {
      code: nature.code,
      name: nature.name,
      section: ruleReference(rule),
      standardRate: Number(rule?.rate || 0),
      standardIndividualRate: Number(rule?.rateIndividual ?? rule?.rate ?? 0),
      companyRate: String(override.rate ?? rule?.rate ?? 0),
      individualRate: String(override.rateIndividual ?? rule?.rateIndividual ?? rule?.rate ?? 0),
      active: override.active !== false,
      linkedLedgerId: String(override.linkedLedgerId || ledgers.find((ledger) => String(ledger.tdsNatureCode || '').toUpperCase() === nature.code)?.id || ''),
      editing: false,
    };
  }), [currentCompany]);
  const [rows, setRows] = useState(initialRows);

  const change = (code, field, value) => setRows((current) => current.map((row) => (
    row.code === code ? { ...row, [field]: value } : row
  )));

  const save = () => {
    const rateOverrides = Object.fromEntries(rows.map((row) => [row.code, {
      rate: rateValue(row.companyRate),
      rateIndividual: rateValue(row.individualRate),
      active: row.active,
      linkedLedgerId: row.linkedLedgerId,
    }]));
    setDb((previous) => ({
      ...previous,
      companies: (previous.companies || []).map((company) => company.id !== companyId ? company : {
        ...company,
        profile: {
          ...(company.profile || {}),
          taxCompliances: {
            ...(company.profile?.taxCompliances || {}),
            tds: { ...(company.profile?.taxCompliances?.tds || {}), rateOverrides },
          },
        },
      }),
      chartOfAccounts: (previous.chartOfAccounts || []).map((ledger) => {
        if (ledger.companyId !== companyId) return ledger;
        const linked = rows.find((row) => String(row.linkedLedgerId) === String(ledger.id));
        if (linked) return { ...ledger, tdsNatureCode: linked.code, tdsRate: rateValue(linked.companyRate), tdsRateIndividual: rateValue(linked.individualRate), tdsRateActive: linked.active };
        return ledger;
      }),
    }));
    notify.success('TDS rates saved.');
  };

  return (
    <div className="space-y-2">
      <PageHeader entity="tds" title="TDS Rates" actions={<button type="button" className="ui-btn ui-btn-primary" onClick={save}><Save size={15} /> Save</button>} />
      <div className="ui-card overflow-hidden">
        <div className="ui-table-scroll" style={{ '--table-scroll-h': 'calc(100dvh - 8rem)' }}>
          <table className="ui-table ui-table-sticky">
            <thead><tr><th>Nature</th><th>Section</th><th className="text-end">Company / Firm %</th><th className="text-end">Individual / HUF %</th><th>Linked Ledger</th><th>Status</th><th className="ui-action-col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.code}>
              <td><div className="font-medium">{row.name}</div><div className="ui-caption">Standard {row.standardRate}%</div></td>
              <td className="ui-mono">{row.section}</td>
              <td><input aria-label={`${row.name} company rate`} disabled={!row.editing} type="number" min="0" max="100" step="0.01" className="ui-input ui-money ms-auto w-24 disabled:opacity-70" value={row.companyRate} onChange={(event) => change(row.code, 'companyRate', event.target.value)} /></td>
              <td><input aria-label={`${row.name} individual rate`} disabled={!row.editing} type="number" min="0" max="100" step="0.01" className="ui-input ui-money ms-auto w-24 disabled:opacity-70" value={row.individualRate} onChange={(event) => change(row.code, 'individualRate', event.target.value)} /></td>
              <td><select aria-label={`${row.name} linked ledger`} disabled={!row.editing} className="ui-select ui-ctl-compact min-w-44" value={row.linkedLedgerId} onChange={(event) => change(row.code, 'linkedLedgerId', event.target.value)}><option value="">Not linked</option>{ledgers.map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.name}</option>)}</select></td>
              <td><button type="button" aria-label={`${row.active ? 'Deactivate' : 'Activate'} ${row.name}`} onClick={() => change(row.code, 'active', !row.active)}><StatusPill status={row.active ? 'Active' : 'Inactive'} /></button></td>
              <td className="ui-action-col"><div className="flex justify-center gap-1"><button type="button" className="ui-icon-btn" aria-label={`Edit ${row.name}`} onClick={() => change(row.code, 'editing', !row.editing)}><Pencil size={14} /></button><button type="button" className="ui-icon-btn" aria-label={`Delete ${row.name} rate override`} onClick={() => setRows((current) => current.map((item) => item.code === row.code ? { ...item, companyRate: String(item.standardRate), individualRate: String(item.standardIndividualRate), linkedLedgerId: '', active: false, editing: false } : item))}><RotateCcw size={14} /></button></div></td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function TcsRatesMaster({ db, setDb, currentCompany }) {
  const companyId = currentCompany?.id;
  const config = getTdsConfig(db, companyId);
  const savedTcs = currentCompany?.profile?.taxCompliances?.tcs || {};
  const [rate, setRate] = useState(String(savedTcs.rate ?? config.rate ?? DEFAULT_CONFIG.rate));
  const [threshold, setThreshold] = useState(String(savedTcs.threshold ?? config.threshold ?? DEFAULT_CONFIG.threshold));

  const save = () => {
    const nextRate = rateValue(rate);
    const nextThreshold = Math.max(0, Number(threshold) || 0);
    setDb((previous) => ({
      ...previous,
      companies: (previous.companies || []).map((company) => company.id !== companyId ? company : {
        ...company,
        profile: {
          ...(company.profile || {}),
          taxCompliances: {
            ...(company.profile?.taxCompliances || {}),
            tcs: { ...(company.profile?.taxCompliances?.tcs || {}), rate: nextRate, threshold: nextThreshold },
          },
        },
      }),
      tdsConfigs: [
        ...(previous.tdsConfigs || []).filter((entry) => entry.companyId !== companyId),
        { ...getTdsConfig(previous, companyId), companyId, rate: nextRate, threshold: nextThreshold },
      ],
    }));
    notify.success('TCS rate saved.');
  };

  return (
    <div className="space-y-2">
      <PageHeader entity="tds" title="TCS Rates" actions={<button type="button" className="ui-btn ui-btn-primary" onClick={save}><Save size={15} /> Save</button>} />
      <div className="ui-card overflow-hidden">
        <table className="ui-table">
          <thead><tr><th>Nature</th><th>Section</th><th className="text-end">Threshold</th><th className="text-end">Rate %</th></tr></thead>
          <tbody><tr>
            <td><div className="font-medium">Collection on sale of goods</div><div className="ui-caption">TCS_ON_SALE_OF_GOODS</div></td>
            <td className="ui-mono">206C(1H)</td>
            <td><input aria-label="TCS threshold" type="number" min="0" step="1" className="ui-input ui-money ms-auto w-40" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></td>
            <td><input aria-label="TCS rate" type="number" min="0" max="100" step="0.01" className="ui-input ui-money ms-auto w-28" value={rate} onChange={(event) => setRate(event.target.value)} /></td>
          </tr></tbody>
        </table>
      </div>
    </div>
  );
}

export default TdsRatesMaster;
