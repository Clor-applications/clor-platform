import { useCallback, useRef, useState } from 'react';

/**
 * One save at a time. `run(fn)` refuses a second call while the first is on
 * its way (a double click, Enter pressed twice), so a form cannot send the
 * same holiday, reader or geofence twice. `saving` drives the disabled
 * button, its "Saving…" word and aria-busy on the form.
 */
export default function useSaving() {
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const run = useCallback(async (fn) => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setSaving(true);
    try {
      return await fn();
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, []);
  return [saving, run];
}

/**
 * Whether a drawer's form differs from what it opened with, for the drawer's
 * `dirty` (Escape or × then asks before throwing the edits away). `markSaved`
 * takes the saved value as the new starting point when the drawer stays open.
 */
export function useDirty(value) {
  const [start, setStart] = useState(() => JSON.stringify(value));
  const dirty = JSON.stringify(value) !== start;
  const markSaved = useCallback((saved) => setStart(JSON.stringify(saved)), []);
  return [dirty, markSaved];
}
