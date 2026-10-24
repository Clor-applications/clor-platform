import React from 'react';
import { Copy } from 'lucide-react';

import { notify } from './notify';

const copy = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    notify.success('Copied.');
  } catch {
    notify.error('Could not copy — select it and copy by hand.');
  }
};

/**
 * A secret shown exactly once, with a copy button: API keys, connector and
 * directory-sync tokens, reader addresses. CLOR keeps only a hash, so this is
 * the one chance to take it.
 */
export default function ShownOnce({ label, value, hint = '', onDone }) {
  return (
    <div className="ui-card space-y-2 p-4" role="alert" style={{ borderColor: 'rgb(var(--warn-ink))' }}>
      <div className="text-sm font-semibold">{label} — shown once. Copy it now; CLOR keeps only a hash and cannot show it again.</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-[rgb(var(--surface-sunken))] px-2 py-1 ui-mono text-xs">{value}</code>
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => copy(value)}><Copy size={14} aria-hidden="true" /> Copy</button>
        <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={onDone}>I have copied it</button>
      </div>
      {hint ? <p className="ui-caption">{hint}</p> : null}
    </div>
  );
}
