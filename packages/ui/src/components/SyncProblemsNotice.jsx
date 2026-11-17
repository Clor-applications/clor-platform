import React from 'react';

import Alert from './ui/Alert';

/**
 * Said on Reports and the GST returns when the books in this browser are not
 * whole: a list failed to load, or was too long to read to its end. Those
 * screens add up what is here, so a missing list is a figure that is short,
 * and it used to be short in silence (audit, 17 Nov 2026).
 */
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export const syncProblemWords = (problems = []) => {
  const failed = [...new Set(problems.filter((p) => p?.kind === 'failed').map((p) => p.what))];
  const short = [...new Set(problems.filter((p) => p?.kind === 'short').map((p) => p.what))];
  if (!failed.length && !short.length) return null;
  const parts = [];
  if (failed.length) parts.push(`${list(failed)} did not load`);
  if (short.length) parts.push(`${list(short)} ${short.length === 1 && !/s$/.test(short[0]) ? 'is' : 'are'} too many to read in full here`);
  const said = parts.join('; ');
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}.`;
};

export default function SyncProblemsNotice({ problems }) {
  const words = syncProblemWords(Array.isArray(problems) ? problems : []);
  if (!words) return null;
  return (
    <div className="px-4 pt-3">
      <Alert tone="warn" title="These figures may be short">
        {words} Reports and returns on this page add up only what has loaded, so do not file from them yet. Reload the page; if this stays, tell CLOR support.
      </Alert>
    </div>
  );
}
