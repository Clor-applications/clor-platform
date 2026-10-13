import { useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';

import { PageHeader } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { getGstStateFromGstin } from '@ui/utils/gst';

const TYPES = ['Registered', 'Composition', 'SEZ', 'Unregistered'];
const emptyRegistration = () => ({ id: `tax-${Date.now()}-${Math.random()}`, registrationType: 'Registered', number: '', state: '' });

export default function TaxRegistrationMaster({ kind, db, setDb, currentCompany, children = null, hideHeader = false }) {
  const lower = kind.toLowerCase();
  const tax = currentCompany?.profile?.taxCompliances || {};
  const source = lower === 'gst'
    ? { registrationType: currentCompany?.gstRegistration || 'Registered', number: currentCompany?.gstin || '', state: currentCompany?.state || '' }
    : { registrationType: tax?.[lower]?.registrationType || 'Applicable', number: tax?.[lower]?.tan || '', state: tax?.[lower]?.state || '' };
  const storedOthers = Array.isArray(tax?.[lower]?.registrations) ? tax[lower].registrations : [];
  const [primary, setPrimary] = useState(source);
  const [others, setOthers] = useState(storedOthers);
  const numberLabel = lower === 'gst' ? 'GSTIN' : 'TAN';

  const save = () => {
    const number = String(primary.number || '').trim().toUpperCase();
    if (primary.registrationType !== 'Unregistered' && !number) return notify.error(`${numberLabel} is required.`);
    setDb((previous) => ({
      ...previous,
      companies: (previous.companies || []).map((company) => {
        if (company.id !== currentCompany.id) return company;
        const profile = company.profile || {};
        const taxCompliances = profile.taxCompliances || {};
        const details = {
          ...(taxCompliances[lower] || {}),
          registrationType: primary.registrationType,
          ...(lower === 'gst' ? {} : { tan: number }),
          state: String(primary.state || '').trim(),
          registrations: others.map((row) => ({ ...row, number: String(row.number || '').trim().toUpperCase(), state: String(row.state || '').trim() })),
        };
        return {
          ...company,
          ...(lower === 'gst' ? { gstRegistration: primary.registrationType, gstin: number, state: details.state } : {}),
          profile: { ...profile, taxCompliances: { ...taxCompliances, [lower]: details } },
        };
      }),
    }));
    notify.success(`${kind} details saved.`);
  };

  const updateOther = (id, patch) => setOthers((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  const fields = (row, update, prefix) => <>
    <td><select aria-label={`${prefix} registration type`} className="ui-select ui-ctl-compact w-full" value={row.registrationType} onChange={(event) => update({ registrationType: event.target.value, ...(lower === 'gst' && event.target.value === 'Unregistered' ? { number: '' } : {}) })}>{(lower === 'gst' ? TYPES : ['Applicable', 'Not Applicable']).map((type) => <option key={type}>{type}</option>)}</select></td>
    <td><input aria-label={`${prefix} ${numberLabel}`} className="ui-input ui-ctl-compact w-full uppercase disabled:cursor-not-allowed disabled:opacity-60" value={row.number} disabled={lower === 'gst' && row.registrationType === 'Unregistered'} onChange={(event) => {
      const number = event.target.value.toUpperCase();
      const state = lower === 'gst' ? getGstStateFromGstin(number) : '';
      update({ number, ...(state ? { state } : {}) });
    }} /></td>
    <td><input aria-label={`${prefix} state`} className="ui-input ui-ctl-compact w-full" value={row.state} onChange={(event) => update({ state: event.target.value })} /></td>
  </>;

  return <div className="space-y-2">
    {!hideHeader ? <PageHeader entity="gst" title={kind} actions={<><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setOthers((rows) => [...rows, emptyRegistration()])}><Plus size={15} /> Add other {kind}</button><button type="button" className="ui-btn ui-btn-primary" onClick={save}><Save size={15} /> Save</button></>} /> : null}
    <div className="ui-card overflow-hidden">
      <table className="ui-table">
        <thead><tr><th>Registration Type</th><th>{numberLabel}</th><th>State</th>{others.length ? <th className="ui-action-col"><span className="sr-only">Actions</span></th> : null}</tr></thead>
        <tbody>
          <tr>{fields(primary, (patch) => setPrimary((row) => ({ ...row, ...patch })), `Primary ${kind}`)}{others.length ? <td /> : null}</tr>
          {others.map((row, index) => <tr key={row.id}>{fields(row, (patch) => updateOther(row.id, patch), `Other ${kind} ${index + 1}`)}<td className="ui-action-col"><button type="button" className="ui-icon-btn" aria-label={`Remove other ${kind} ${index + 1}`} onClick={() => setOthers((rows) => rows.filter((item) => item.id !== row.id))}><Trash2 size={15} /></button></td></tr>)}
        </tbody>
      </table>
    </div>
    {children}
  </div>;
}
