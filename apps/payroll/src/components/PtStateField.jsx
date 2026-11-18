import React, { useEffect, useMemo, useState } from 'react';

import { GST_STATE_BY_CODE } from '@ui/utils/gst';
import { requestOpenScreen } from '@platform/context';
import { getEmployee } from '../api/payrollPeople';

/*
 * Round 25 pick: the professional tax state is picked from the work site.
 * Left blank, the save fills in the site's state (as a transfer does); a
 * state chosen here stays. "See slab" opens the state's bands in Compliance.
 */
const STATES = [...new Set(Object.values(GST_STATE_BY_CODE).filter((s) => !/\(Old\)/.test(s)))].sort((a, b) => a.localeCompare(b));

export default function PtStateField({ employeeId, value, onChange, id = 'employee-pt-state', label = 'Professional tax state', showSlab = true }) {
  const [site, setSite] = useState(null);
  useEffect(() => {
    if (!employeeId) return undefined;
    let live = true;
    getEmployee(employeeId)
      .then((r) => live && setSite(r?.ptFromSite || null))
      .catch(() => live && setSite(null));
    return () => {
      live = false;
    };
  }, [employeeId]);

  /* A state on file that is not in the list (spelled another way) still shows. */
  const options = useMemo(() => (value && !STATES.includes(value) ? [value, ...STATES] : STATES), [value]);
  const state = value || site?.state || '';

  return (
    <div>
      <label className="ui-label" htmlFor={id}>{label}</label>
      <select id={id} className="ui-select w-full" value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-hint`}>
        <option value="">{site ? `From the work site (${site.state})` : 'Choose a state'}</option>
        {options.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <p id={`${id}-hint`} className="ui-caption mt-1">
        {site && !value ? `Follows ${site.site}, in ${site.state}. ` : site && value && value !== site.state ? `Their work site ${site.site} is in ${site.state}. ` : ''}
        {state && showSlab ? (
          <button type="button" className="ui-link" onClick={() => requestOpenScreen('compliance', { scheme: 'PT', state })}>
            See {state}’s slab
          </button>
        ) : null}
      </p>
    </div>
  );
}
