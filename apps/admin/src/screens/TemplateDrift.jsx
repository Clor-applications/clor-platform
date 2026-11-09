import React from 'react';
import { permissionLabel } from './permissionKeys';

const SHOWN = 4;
const list = (modules, keys) => {
  const names = keys.slice(0, SHOWN).map((k) => permissionLabel(modules, k));
  return keys.length > SHOWN ? `${names.join(', ')} and ${keys.length - SHOWN} more` : names.join(', ');
};

/**
 * A stock role someone changed (owner, 8 Nov 2026): when a template moves on, only roles nobody changed follow it.
 * This says what the template has now that the role lacks, and what the role has besides, so an administrator can
 * take the template or keep their own. Nothing for a role that matches, or that is not a stock role.
 */
export default function TemplateDrift({ template, modules, onMatch }) {
  if (!template || template.matches) return null;
  const missing = template.missing || [];
  const extra = template.extra || [];
  return (
    <div className="ws-notice grid gap-1" role="note" aria-label={`Differs from the ${template.label} template`}>
      <p className="font-medium">Differs from the {template.label} template</p>
      {missing.length ? <p>The template also gives {list(modules, missing)}.</p> : null}
      {extra.length ? <p>This role also has {list(modules, extra)}.</p> : null}
      {onMatch ? (
        <p>
          <button type="button" className="ws-btn ws-btn--small ws-btn--quiet" onClick={onMatch}>Match the template</button>
        </p>
      ) : null}
    </div>
  );
}
