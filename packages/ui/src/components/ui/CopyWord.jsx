import { useEffect, useRef, useState } from 'react';
import { Copy } from '@ui/components/ui/lineIcons';

/**
 * "Copy" as a word beside a number people often need elsewhere: a GSTIN, a PAN, an employee ID
 * (owner's style pick, 17 Nov 2026). Says "Copied" for a moment after. Where the browser refuses
 * the clipboard it selects the number instead, so Ctrl+C still works.
 * Round 61 "copyvalue" A (newest pick wins): a small copy icon, and "Copied" for a moment after.
 */
export default function CopyWord({ value, label = 'Copy', what = '' }) {
  const [done, setDone] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!value) return null;
  const copy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(String(value));
      setDone(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 1500);
    } catch {
      const node = e.currentTarget.previousElementSibling;
      if (node) { const r = document.createRange(); r.selectNodeContents(node); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r); }
    }
  };
  return (
    <button type="button" className="ui-copy-word" title={`${label}${what ? ` ${what}` : ''}`} onClick={copy} aria-label={done ? 'Copied' : `${label}${what ? ` ${what}` : ''}`}>
      {done ? <span className="ui-copy-word-done">Copied</span> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}
