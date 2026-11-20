import React from 'react';

/**
 * A row's status tag, shown only when the row is an exception (DESIGN.md "Status tags"): waiting on someone,
 * failed, missing, overdue. A row in the expected state shows no tag; its status is still read out to a
 * screen reader, and filters and exports keep every status.
 *
 * label: the exception's word; leave it empty for a row in the expected state.
 * normal: the expected state's word, for screen readers only.
 * tone: 'warn' (default) | 'neg' | 'neutral'.
 * pill: a whole pill class from a screen's own status map ('ui-pill-warn'), in place of tone.
 */
export function ExceptionTag({ label, normal, tone = 'warn', pill }) {
  if (label) return <span className={`ui-pill ${pill || `ui-pill-${tone}`}`}>{label}</span>;
  return normal ? <span className="sr-only">{normal}</span> : null;
}

/** Exceptions sort first; every other row keeps the order it came in. */
export function exceptionsFirst(rows, isException) {
  const first = [];
  const rest = [];
  for (const r of rows || []) (isException(r) ? first : rest).push(r);
  return first.length && rest.length ? [...first, ...rest] : rows || [];
}

export default ExceptionTag;
