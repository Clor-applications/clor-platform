import React from 'react';
import { Link2 } from 'lucide-react';
import { notify } from '@ui/components/ui/notify';

/** Whether the address carries a list's own state (its filters, tab or search) as `s.<key>`. */
export function addressHasFilters(search) {
  try {
    for (const k of new URLSearchParams(search || '').keys()) if (k.startsWith('s.') && k.length > 2) return true;
  } catch { /* an odd address has no filters */ }
  return false;
}

/**
 * "Copy link" on a filtered list (round 22 pick "sharelink" A): the address
 * already holds the filters, so the link opens the same list for whoever gets
 * it (their own access still applies). Shown only once something is filtered,
 * and never in Books.
 */
export default function CopyListLink() {
  if (typeof window === 'undefined') return null;
  if (document.documentElement.dataset.palette === 'indigo') return null;
  if (!addressHasFilters(window.location.search)) return null;
  const copy = () => {
    const href = window.location.href;
    const done = () => notify.success('Link copied. It opens this list with the same filters.');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(href).then(done, () => notify.error('The link could not be copied.'));
    else notify.error('The link could not be copied.');
  };
  return (
    <button type="button" className="ui-btn ui-btn-ghost ui-copy-link" onClick={copy}>
      <Link2 size={15} aria-hidden="true" />Copy link
    </button>
  );
}
