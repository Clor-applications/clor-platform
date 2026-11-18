import React from 'react';

/*
 * Round 46 picks (18 Nov 2026), documents and letters, outside Books.
 * - docfolders A: a person's documents in folders: Identity, Joining, Letters, Payroll, Other.
 * - certexpiry B: a list of what runs out next month (the Documents screen's "Next month" tab).
 * - lettervars A: a letter's fields read as grey chips in plain words, not {{codes}}.
 */

/** The folder each document kind sits in, in the order folders are shown. */
export const DOC_FOLDERS = [
  ['Identity', ['ID_PROOF', 'ADDRESS_PROOF', 'WORK_PERMIT']],
  ['Joining', ['CONTRACT', 'EDUCATION', 'CERTIFICATE']],
  ['Letters', ['LETTER']],
  ['Payroll', ['PAYSLIP']],
  ['Other', []],
];

export function folderOf(kind) {
  const hit = DOC_FOLDERS.find(([, kinds]) => kinds.includes(kind));
  return hit ? hit[0] : 'Other';
}

/** Documents grouped by folder, folders in fixed order, empty folders left out; each keeps the list's own order. */
export function docFolders(docs = []) {
  const by = new Map(DOC_FOLDERS.map(([name]) => [name, []]));
  for (const d of docs) by.get(folderOf(d?.kind)).push(d);
  return [...by.entries()].filter(([, list]) => list.length).map(([name, list]) => ({ name, docs: list }));
}

/** The first and last day of the calendar month after `today` (YYYY-MM-DD, India's date). */
export function nextMonthRange(today) {
  const [y, m] = String(today).slice(0, 10).split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, '0');
  return { from: `${ny}-${pad(nm)}-01`, to: `${ny}-${pad(nm)}-${pad(last)}`, label: new Date(Date.UTC(ny, nm - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
}

export function expiresNextMonth(doc, today) {
  if (!doc?.expiresOn) return false;
  const { from, to } = nextMonthRange(today);
  return doc.expiresOn >= from && doc.expiresOn <= to;
}

/** `dateOfJoining` → "Date of joining", `extra.effective_date` → "Effective date", `employee.firstName` → "First name". */
export function fieldWords(token) {
  const last = String(token || '').split('.').pop();
  const words = last.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
}

/** The letter as it will read, each {{field}} drawn as a grey chip in plain words. */
export function LetterFieldsPreview({ body = '' }) {
  if (typeof document !== 'undefined' && document.documentElement.dataset.palette === 'indigo') return null;
  if (!/\{\{[^}]+\}\}/.test(body)) return null;
  const parts = String(body).split(/(\{\{[^}]+\}\})/g);
  return (
    <section className="ui-letter-preview" aria-label="How the letter reads">
      <h3 className="ui-label">How it reads</h3>
      <p className="ui-letter-preview-body">
        {parts.map((p, i) => {
          const m = /^\{\{\s*([^}]+?)\s*\}\}$/.exec(p);
          return m ? <span key={i} className="ui-merge-chip" title={`Filled in from ${fieldWords(m[1]).toLowerCase()}`}>{fieldWords(m[1])}</span> : <React.Fragment key={i}>{p}</React.Fragment>;
        })}
      </p>
    </section>
  );
}
