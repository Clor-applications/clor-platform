import React, { useMemo, useState } from 'react';
import { ChevronDown, Lock } from 'lucide-react';

import { displayModules, moduleKeys, permissionKey } from './permissionKeys';
import './workspace.css';

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

export default function PermissionMatrix({ modules: given, granted, onToggle, onSetMany, initiallyOpen = 2 }) {
  /* Every editor draws the same sections, Time & Leave included, whichever list it was handed (split already or not). */
  const modules = useMemo(() => displayModules(given), [given]);
  /* Two sections share the ATTENDANCE key, which every wire key carries; displayKey tells them apart on screen. */
  const idOf = (m) => m.displayKey || m.key;
  const [openModules, setOpenModules] = useState(() => new Set(modules.slice(0, initiallyOpen).map(idOf)));
  const keysOf = moduleKeys;

  return (
    <div className="grid gap-3">
      {modules.map((mod) => {
        const keys = keysOf(mod);
        const on = keys.filter((k) => granted.has(k)).length;
        const all = on === keys.length && keys.length > 0;
        const some = on > 0 && !all;
        const id = idOf(mod);
        const isOpen = openModules.has(id);

        /* One surface per module: its header and, when open, its table — no box inside a box. */
        return (
          <section key={id} className="ws-table-wrap" aria-label={mod.label}>
            <div
              className="flex items-center justify-between gap-3"
              style={{ padding: '12px 14px', borderBottom: isOpen ? '1px solid rgb(var(--ws-line))' : 'none' }}
            >
              <button
                type="button"
                className="flex items-center gap-2 min-w-0 text-left"
                onClick={() =>
                  setOpenModules((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                aria-expanded={isOpen}
              >
                <ChevronDown size={16} aria-hidden="true" className={`transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`} />
                <span className="text-sm" style={{ fontWeight: 600 }}>{mod.label}</span>
                <span className={`ws-pill${on ? ' ws-pill--role' : ''}`}>{on} of {keys.length}</span>
                {mod.key === 'SETTINGS' ? (
                  <span className="ws-pill">
                    <Lock size={10} aria-hidden="true" /> Administration
                  </span>
                ) : null}
              </button>

              <label className="flex items-center gap-2 text-xs cursor-pointer shrink-0" style={{ color: 'rgb(var(--ws-muted))' }}>
                <input
                  type="checkbox"
                  checked={all}
                  ref={(el) => {
                    if (el) el.indeterminate = some;
                  }}
                  onChange={(e) => onSetMany(keys, e.target.checked)}
                  aria-label={`Grant every permission in ${mod.label}`}
                />
                All
              </label>
            </div>

            {isOpen ? (
              <table className="ws-table">
                <thead>
                  <tr>
                    <th scope="col">Resource</th>
                    {ACTION_ORDER.map((a) => (
                      <th key={a} scope="col" style={{ textAlign: 'center' }}>{actionLabel[a]}</th>
                    ))}
                    <th scope="col" style={{ textAlign: 'center' }}>Row</th>
                  </tr>
                </thead>
                <tbody>
                  {mod.resources.map((r) => {
                    const rowKeys = r.actions.map((a) => key(mod.key, r.key, a));
                    const rowAll = rowKeys.every((k) => granted.has(k));
                    return (
                      <tr key={r.key}>
                        <td style={{ whiteSpace: 'normal', minWidth: 180 }}>
                          <div>{r.label}</div>
                          {r.description ? <div className="ui-caption">{r.description}</div> : null}
                        </td>
                        {ACTION_ORDER.map((a) => {
                          const supported = r.actions.includes(a);
                          const k = key(mod.key, r.key, a);
                          return (
                            <td key={a} style={{ textAlign: 'center' }}>
                              {supported ? (
                                <input type="checkbox" checked={granted.has(k)} onChange={() => onToggle(k)} aria-label={`${actionLabel[a]} ${r.label}`} />
                              ) : (
                                <span style={{ color: 'rgb(var(--ws-muted))' }} aria-label="Not applicable">–</span>
                              )}
                            </td>
                          );
                        })}
                        <td style={{ textAlign: 'center' }}>
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
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
