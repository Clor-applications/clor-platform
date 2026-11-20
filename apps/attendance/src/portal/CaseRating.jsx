import React, { useState } from 'react';

/**
 * Round 52 (CASERATE a): under HR's answer, "Did this solve it?" Yes / No.
 * No reopens the case (the existing reopen, so the seven-day window still
 * holds); Yes is remembered on this device so the question is not asked
 * again. Nothing new goes to the server.
 */
const KEY = (id) => `clor.r52.solved.${id}`;
const read = (id) => {
  try { return window.localStorage.getItem(KEY(id)) === '1'; } catch { return false; }
};

export default function CaseRating({ id, busy, onReopen }) {
  const [solved, setSolved] = useState(() => read(id));
  if (solved) return <p className="ui-caption" role="status">Glad it is sorted. Ask a new question any time.</p>;
  const yes = () => {
    try { window.localStorage.setItem(KEY(id), '1'); } catch { /* private window: asked again next time */ }
    setSolved(true);
  };
  return (
    <div className="r52-case-rate space-y-2" role="group" aria-labelledby={`rate-${id}`}>
      <p id={`rate-${id}`} className="text-sm font-semibold">Did this solve it?</p>
      <div className="flex gap-2">
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={yes}>Yes, solved</button>
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={onReopen}>No, reopen</button>
      </div>
    </div>
  );
}
