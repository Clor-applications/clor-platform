import React, { useEffect } from 'react';
import { Lock } from 'lucide-react';

import PopupSelect from './pickers/PopupSelect';
import { useFeatures } from '../permissions/useFeatures';

/**
 * The warehouse a document belongs to.
 *
 * The header is where a user says where they are working. Once they have
 * picked a branch and a warehouse there, every entry belongs to that place and
 * asking again on each form is both noise and a chance to file a bill against
 * the wrong shelf. So this field locks to the header selection and simply says
 * so. With "All warehouses" picked — a supervisor looking across the company —
 * there is nothing to inherit, and the field asks.
 *
 * An existing document keeps whatever warehouse it was created in: rewriting
 * that silently because someone opened it from another warehouse would move
 * stock nobody asked to move.
 */
const WarehouseField = ({
  value,
  onChange,
  options = [],
  activeWarehouseId = '',
  branchLabel = '',
  isEdit = false,
  label = 'Warehouse *',
  showSourceHint = true,
  /* Not the same as `locked` above, which pins the field to the header's
     warehouse. This is the caller saying the document itself may no longer be
     re-attributed — a posted invoice's stock attribution is part of what was
     posted. */
  disabled = false,
  /* Drawn inside the control when the field is asking. The locked form keeps
     the padlock: one glyph in a field, and there it means "not yours to
     change", which outranks saying "warehouse" twice. */
  icon = null,
  // Sized and validated by the panel itself now that this is a searchable
  // dropdown rather than a <select>. Call sites still pass both; swallowed
  // here rather than made every caller's problem to remove.
  ...ignoredLegacyProps
}) => {
  void ignoredLegacyProps;
  const { isEnabled } = useFeatures();
  const featureLocked = !isEnabled('warehouses');
  const active = String(activeWarehouseId || '').trim();
  const fallback = String(value || active || options[0]?.id || '').trim();
  const lockedValue = featureLocked ? fallback : active;
  const locked = featureLocked || (Boolean(active) && !isEdit);

  // Keep the form's value on the header selection while it is locked.
  useEffect(() => {
    if (!locked) return;
    if (!lockedValue || String(value || '') === lockedValue) return;
    onChange?.(lockedValue);
  }, [locked, lockedValue, value, onChange]);

  if (locked) {
    const picked = options.find((w) => String(w.id) === lockedValue);
    const name = picked?.name || (lockedValue ? `Warehouse ${lockedValue}` : 'Default warehouse');
    const pinned = `${branchLabel ? `${branchLabel} · ` : ''}${name}`;
    return (
      <div>
        <label className="ui-label" htmlFor="warehouse-pinned">
          {label.replace(' *', '')}
        </label>
        {/*
          A read-only input, not a div wearing an input's clothes.
          This was a plain <div aria-readonly>, so it was not in the tab order:
          Tab out of Branch landed on Customer and the warehouse field was
          stepped over entirely, which read as Tab skipping a field. A readonly
          input is the honest control — it is reached in sequence, its value can
          be selected and copied, and it still cannot be edited.
        */}
        <div className="relative">
          <Lock
            size={14}
            className="ui-muted absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            id="warehouse-pinned"
            type="text"
            readOnly
            value={pinned}
      title={pinned}
            className="ui-input w-full ui-sunken ps-8 truncate"
          />
        </div>
        {/* Suppressed where the form asks for the branch itself: the sentence
            points at a header control that is no longer the one in charge. */}
        {showSourceHint ? (
          <div className="text-xs ui-muted mt-1">From the header. Switch it there to enter somewhere else.</div>
        ) : null}
      </div>
    );
  }

  /*
   * The same searchable dropdown the customer, vendor, item and account
   * fields use, rather than a bare <select>. A company with forty warehouses
   * could not type to find one, and the keyboard behaviour differed from
   * every other selection on the same form.
   */
  return (
    <div>
      <PopupSelect
        label={label}
        title="warehouses"
        value={String(value || '')}
        onChange={(next) => onChange?.(next)}
        options={options.map((w) => ({ value: String(w.id), label: w.name || `Warehouse ${w.id}` }))}
        placeholder="Select Warehouse"
        showValueSubtext={false}
        icon={icon}
        disabled={disabled}
      />
    </div>
  );
};

export default WarehouseField;
