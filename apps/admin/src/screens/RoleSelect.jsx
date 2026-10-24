import React from 'react';

/*
 * Picking a role for somebody.
 *
 * Seventeen roles in one flat list, with Owner and Administrator side by side
 * and nothing to say what either does, made the choice a guess. Roles are
 * filed under the team they belong to (the server says which), and the chosen
 * role's description sits under the list so the decision is made on what the
 * role does rather than what it is called.
 */

const GROUP_ORDER = ['Administration', 'Accounting', 'Sales', 'Purchase', 'Inventory', 'Payroll', 'Read-only', 'Custom'];

export default function RoleSelect({ id, roles, value, onChange, allowCreate = false, onCreateNew }) {
  const groups = new Map();
  for (const r of roles || []) {
    const g = r.group || 'Custom';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  const ordered = [...groups.keys()].sort(
    (a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99)
  );
  const selected = (roles || []).find((r) => String(r.id) === String(value)) || null;

  return (
    <div>
      <select
        id={id}
        className="ui-select w-full ui-surface"
        value={value}
        aria-describedby={selected ? `${id}-about` : undefined}
        onChange={(e) => {
          if (e.target.value === '__new__') {
            onCreateNew?.();
            return;
          }
          onChange(e.target.value);
        }}
      >
        <option value="">— No role —</option>
        {ordered.map((g) => (
          <optgroup key={g} label={g}>
            {groups.get(g).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.ownDocumentsOnly ? ' (own documents only)' : ''}
              </option>
            ))}
          </optgroup>
        ))}
        {allowCreate ? <option value="__new__">+ Create new role…</option> : null}
      </select>
      {selected?.description ? (
        <div id={`${id}-about`} className="ui-subtle text-xs mt-1">
          {selected.description}
        </div>
      ) : null}
    </div>
  );
}
