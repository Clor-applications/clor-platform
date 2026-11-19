import React from "react";

import { displayModules, permissionKey } from "./permissionKeys";

/*
 * Round 38 pick "Seeing what a role can see" (B): a plain list, by screen, of
 * what a role can see and what it can change, read from the same server
 * catalogue the permission grid uses. Only screens the role reaches are
 * listed; a role that reaches nothing says so.
 */

const CHANGE_ORDER = ["CREATE", "EDIT", "DELETE", "APPROVE", "EXPORT"];
const CHANGE_WORD = {
  CREATE: "add",
  EDIT: "edit",
  DELETE: "delete",
  APPROVE: "approve",
  EXPORT: "export",
};

/** [{ id, label, rows: [{ key, label, see, change: ['add', 'edit', …] }] }], screens the role reaches only. */
export function roleAccessList(modules, granted) {
  const has = (k) => Boolean(granted && granted.has(k));
  return displayModules(modules || [])
    .map((mod) => {
      const rows = (mod.resources || [])
        .map((r) => {
          const on = (a) =>
            (r.actions || []).includes(a) &&
            has(permissionKey(mod.key, r.key, a));
          const change = CHANGE_ORDER.filter(on).map((a) => CHANGE_WORD[a]);
          const see = on("VIEW") || change.length > 0;
          return { key: r.key, label: r.label || r.key, see, change };
        })
        .filter((row) => row.see);
      return {
        id: mod.displayKey || mod.key,
        label: mod.label || mod.key,
        rows,
      };
    })
    .filter((m) => m.rows.length);
}

/** "add, edit and approve" */
export function changeWords(change) {
  if (!change.length) return "";
  if (change.length === 1) return change[0];
  return `${change.slice(0, -1).join(", ")} and ${change[change.length - 1]}`;
}

export function RoleAccessList({ modules, granted, roleName = "This role" }) {
  const groups = roleAccessList(modules, granted);
  if (!groups.length) {
    return (
      <p className="ws-foot-note">
        {roleName} can see nothing yet. Edit the role to give it screens.
      </p>
    );
  }
  return (
    <div
      className="ui-role-access"
      aria-label={`What ${roleName} can see and change`}
    >
      {groups.map((g) => (
        <section key={g.id} aria-label={g.label}>
          <h3 className="ui-role-access-head">{g.label}</h3>
          <table className="ui-role-access-table">
            <thead>
              <tr>
                <th scope="col">Screen</th>
                <th scope="col">Can see</th>
                <th scope="col">Can change</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td>
                    <span className="ws-state" data-tone="ok">Yes</span>
                  </td>
                  <td>
                    {row.change.length ? (
                      <span className="ws-state" data-tone="ok">Yes: {changeWords(row.change)}</span>
                    ) : (
                      <span className="ws-state" data-tone="off">No</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
