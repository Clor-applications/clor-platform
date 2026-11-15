import React, { useEffect, useMemo } from 'react';
import { Building2, Lock } from '@ui/components/ui/lineIcons';

import PopupSelect from './pickers/PopupSelect';
import { useFeatures } from '../permissions/useFeatures';
import { branchLabel as formatBranchLabel } from '../utils/branchLabel';

/**
 * Operational branch selector used by transaction forms.
 *
 * Transactions always belong to a real branch. A single branch is therefore
 * selected automatically and shown read-only; only companies with two or more
 * available branches need a selector. There is deliberately no company-wide
 * "All branches" value on an entry form.
 */
const BranchField = ({ value, onChange, options = [], label = 'Branch', icon = Building2 }) => {
  const { isEnabled } = useFeatures();
  const rows = useMemo(
    () => (Array.isArray(options) ? options : []).filter((row) => row?.id != null && String(row.id).trim()),
    [options]
  );
  const current = String(value || '').trim();
  const validCurrent = rows.some((row) => String(row.id) === current) ? current : '';
  const effective = validCurrent || String(rows[0]?.id || '').trim();
  const locked = !isEnabled('branches') || rows.length <= 1;

  useEffect(() => {
    if (!effective || current === effective) return;
    onChange?.(effective);
  }, [current, effective, onChange]);

  if (locked) {
    const picked = rows.find((row) => String(row.id) === effective) || rows[0];
    const name = formatBranchLabel(picked || {}) || 'Head Office';
    return (
      <div>
        <label className="ui-label" htmlFor="branch-pinned">{label.replace(' *', '')}</label>
        <div className="relative">
          <Lock size={14} className="ui-muted pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input id="branch-pinned" className="ui-input ui-sunken w-full ps-8" readOnly value={name} title={name} />
        </div>
      </div>
    );
  }

  return (
    <PopupSelect
      label={label}
      title="branches"
      value={effective}
      onChange={onChange}
      icon={icon}
      options={rows.map((row) => ({ value: String(row.id), label: formatBranchLabel(row) }))}
      placeholder="Select Branch"
      showValueSubtext={false}
    />
  );
};

export default BranchField;
