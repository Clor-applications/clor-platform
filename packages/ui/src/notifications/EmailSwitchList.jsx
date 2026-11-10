import React from 'react';

/**
 * One list of emails a company can switch off: a tick for each, its name and
 * who gets it, rows ruled apart by one hairline. Workspace → Email
 * notifications shows one per app; Accounting → Settings → Email shows the
 * same list on its Notifications tab. The parent keeps the state and saves.
 */
export default function EmailSwitchList({ events = [], onToggle, disabled = false, labelledBy }) {
  return (
    <ul className="grid" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-labelledby={labelledBy}>
      {events.map((e, idx) => (
        <li key={e.key} style={idx ? { borderTop: '1px solid rgb(var(--border))' } : undefined}>
          <label className={`flex items-start gap-3 py-3 ${disabled ? '' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              className="ui-checkbox mt-0.5"
              checked={Boolean(e.enabled)}
              disabled={disabled}
              onChange={(ev) => onToggle?.(e.key, ev.target.checked)}
            />
            <span className="min-w-0 grid gap-0.5">
              <span className="text-sm font-medium" style={{ color: 'rgb(var(--fg))' }}>{e.label}</span>
              {e.description ? <span className="ui-caption">{e.description}</span> : null}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}
