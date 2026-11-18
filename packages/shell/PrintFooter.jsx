import React, { useEffect, useState } from 'react';

/**
 * Round 26 pick: the last line on a printed page says who printed it, from
 * CLOR, and when: "Printed by Anita Rao from CLOR · 18 Nov 2026, 4:12 PM".
 * Hidden on screen; shown only in print (picks.css), at the foot of each
 * page. Not drawn in Books, and printed documents (invoices, vouchers) that
 * print through their own frame are untouched.
 */
export function printedLine(name, when = new Date()) {
  const at = when.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\bam\b/, 'AM').replace(/\bpm\b/, 'PM');
  return `${name ? `Printed by ${name} from CLOR` : 'Printed from CLOR'} · ${at}`;
}

export default function PrintFooter({ name }) {
  /* Drawn only while the page prints, so the signed-in name never sits in the screen's own text. */
  const [when, setWhen] = useState(null);
  useEffect(() => {
    const start = () => setWhen(new Date());
    const end = () => setWhen(null);
    window.addEventListener('beforeprint', start);
    window.addEventListener('afterprint', end);
    return () => { window.removeEventListener('beforeprint', start); window.removeEventListener('afterprint', end); };
  }, []);
  if (!when) return null;
  if (typeof document !== 'undefined' && document.documentElement.dataset.palette === 'indigo') return null;
  return <div className="ui-print-footer" aria-hidden="true">{printedLine(name, when)}</div>;
}
