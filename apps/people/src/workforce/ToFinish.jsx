import React from 'react';
import { detailsToFinish } from './round59';

/**
 * Round 59 quickadd A: under the record's summary, the details still missing,
 * each one opening the place it is filled in. Drawn only for someone who can
 * edit the record; nothing shows once it is complete.
 */
export default function ToFinish({ person, canEdit, go }) {
  if (!canEdit) return null;
  const missing = detailsToFinish(person);
  if (!missing.length) return null;
  return (
    <section className="ui-to-finish" aria-label="Details to finish">
      <p className="ui-to-finish-head">
        <span className="font-medium">{missing.length} {missing.length === 1 ? 'detail' : 'details'} to finish</span>
      </p>
      <ul className="ui-to-finish-list">
        {missing.map((d) => (
          <li key={d.key}>
            <button type="button" className="ui-link" onClick={() => go({ tab: d.tab, edit: d.edit || null, action: d.action || null })}>{d.label}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
