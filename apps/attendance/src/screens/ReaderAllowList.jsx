import React, { useId } from 'react';

/**
 * A reader's own allow-list, on its page (Attendance, Readers).
 *
 * A ZKTeco / eSSL reader is known only by the serial number printed on it, so
 * a company can say which network addresses its punches are accepted from.
 * One address or range per line; empty means no rule of its own. The server
 * checks every entry and answers with the one it cannot read.
 */

/** What is typed, as the list the server takes: one entry per line (commas work too), blanks dropped. */
export const allowListOf = (text) =>
  String(text || '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** The stored list as the text the field shows. */
export const allowListText = (list) => (list || []).join('\n');

export default function ReaderAllowList({ value, onChange, readerAddresses = [] }) {
  const id = useId();
  const typed = allowListOf(value);
  /* The addresses the reader itself has called from: offered, so nobody has to find out what their office's is. */
  const missing = readerAddresses.filter((a) => !typed.includes(a));
  return (
    <div>
      <label className="ui-label" htmlFor={`${id}-list`}>Only accept punches from these network addresses</label>
      <textarea
        id={`${id}-list`}
        className="ui-input ui-mono w-full"
        rows={3}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={'203.0.113.7\n203.0.113.0/24'}
        aria-describedby={`${id}-help`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}-help`} className="ui-caption">
        One per line: your office’s internet address, or a range such as 203.0.113.0/24. This is the address your internet provider gives the office, not the reader’s own
        192.168… address. Punches sent in this reader’s name from anywhere else are refused and noted under Reader logs. Leave empty to have no such rule.
      </p>
      {readerAddresses.length ? (
        <p className="ui-caption mt-1">
          This reader has called from{' '}
          {readerAddresses.map((a, i) => (
            <React.Fragment key={a}>
              {i ? ', ' : ''}
              <code className="ui-mono">{a}</code>
            </React.Fragment>
          ))}
          .{' '}
          {missing.length ? (
            <button type="button" className="ui-link" onClick={() => onChange(allowListText([...typed, ...missing]))}>
              {missing.length === 1 ? 'Add it to the list' : 'Add them to the list'}
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
