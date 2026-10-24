import React, { useState } from 'react';
import { ChevronDown, Lock } from 'lucide-react';

import { moduleKeys, permissionKey } from './permissionKeys';

/*
 * The permission matrix: module sections, one row per resource, one column
 * per action the catalogue declares for it.
 *
 * Rendered from the server's catalogue, never from a list kept here. The
 * Roles screen used to keep its own list, and nine of its twenty-one rows
 * named permissions no route checks — ticking them granted nothing, and once
 * the server began validating grants, ticking them made the save fail. Both
 * role editors draw this one component from the same catalogue now.
 */

/** Every action used anywhere in the catalog, in a stable display order. */
const ACTION_ORDER = ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'EXPORT'];

const actionLabel = {
  VIEW: 'View',
  CREATE: 'Create',
  EDIT: 'Edit',
  DELETE: 'Delete',
  APPROVE: 'Approve',
  EXPORT: 'Export',
};

const key = permissionKey;

export default function PermissionMatrix({ modules, granted, onToggle, onSetMany, initiallyOpen = 2 }) {
  const [openModules, setOpenModules] = useState(() => new Set((modules || []).slice(0, initiallyOpen).map((m) => m.key)));
  const keysOf = moduleKeys;

  return (
    <div className="space-y-3">
      {modules.map((mod) => {
        const keys = keysOf(mod);
        const on = keys.filter((k) => granted.has(k)).length;
        const all = on === keys.length && keys.length > 0;
        const some = on > 0 && !all;
        const isOpen = openModules.has(mod.key);

        return (
          <section key={mod.key} className="ui-card overflow-hidden">
            <div
              className="flex items-center justify-between gap-3 px-4 py-3"
              style={{ borderBottom: isOpen ? '1px solid rgb(var(--border))' : 'none' }}
            >
              <button
                type="button"
                className="flex items-center gap-2 min-w-0 text-left"
                onClick={() =>
                  setOpenModules((prev) => {
                    const next = new Set(prev);
                    if (next.has(mod.key)) next.delete(mod.key);
                    else next.add(mod.key);
                    return next;
                  })
                }
                aria-expanded={isOpen}
              >
                <ChevronDown
                  size={16}
                  aria-hidden="true"
                  className={`transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`}
                />
                <span className="ui-title text-sm">{mod.label}</span>
                <span className={`ui-pill ${on ? 'ui-pill-neutral' : 'ui-pill-neutral'}`}>
                  {on}/{keys.length}
                </span>
                {mod.key === 'SETTINGS' ? (
                  <span className="ui-pill ui-pill-warn">
                    <Lock size={10} aria-hidden="true" /> Administration
                  </span>
                ) : null}
              </button>

              <label className="flex items-center gap-2 text-xs ui-muted cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={all}
                  ref={(el) => {
                    if (el) el.indeterminate = some;
                  }}
                  onChange={(e) => onSetMany(keys, e.target.checked)}
                  aria-label={`Grant every permission in ${mod.label}`}
                />
                Select all
              </label>
            </div>

            {isOpen ? (
              <div className="overflow-x-auto">
                <table className="ui-table ui-table-wide">
                  <thead>
                    <tr>
                      <th scope="col">Resource</th>
                      {ACTION_ORDER.map((a) => (
                        <th key={a} scope="col" className="text-center">
                          {actionLabel[a]}
                        </th>
                      ))}
                      <th scope="col" className="text-center">
                        Row
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {mod.resources.map((r) => {
                      const rowKeys = r.actions.map((a) => key(mod.key, r.key, a));
                      const rowAll = rowKeys.every((k) => granted.has(k));
                      return (
                        <tr key={r.key}>
                          <td className="ui-col-meta">
                            <div>{r.label}</div>
                            {r.description ? <div className="ui-subtle text-xs">{r.description}</div> : null}
                          </td>
                          {ACTION_ORDER.map((a) => {
                            const supported = r.actions.includes(a);
                            const k = key(mod.key, r.key, a);
                            return (
                              <td key={a} className="text-center">
                                {supported ? (
                                  <input
                                    type="checkbox"
                                    checked={granted.has(k)}
                                    onChange={() => onToggle(k)}
                                    aria-label={`${actionLabel[a]} ${r.label}`}
                                  />
                                ) : (
                                  <span className="ui-subtle" aria-label="Not applicable">
                                    –
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          <td className="text-center">
                            <input
                              type="checkbox"
                              checked={rowAll}
                              ref={(el) => {
                                if (el) el.indeterminate = !rowAll && rowKeys.some((k) => granted.has(k));
                              }}
                              onChange={(e) => onSetMany(rowKeys, e.target.checked)}
                              aria-label={`Grant every action on ${r.label}`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
