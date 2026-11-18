import React from 'react';
import { guessField } from '@ui/personnel/Employees';

/*
 * Round 49 picks (18 Nov 2026), on Import employees:
 *  - switchfrom A: a sheet exported from another HR tool is recognised by its
 *    column names, and those columns are matched without hand mapping.
 *  - dateformat A: dates are read day first (Indian), and one example from the
 *    file is shown so the reader can confirm it reads right.
 *  - importprogress B: while a big import runs, a progress bar and "stay on
 *    this page".
 */

/* Column names as each tool's own employee export spells them (lower-cased, letters only). */
const OTHER_TOOLS = [
  { tool: 'Keka', marks: ['employeenumber', 'displayname', 'datejoined', 'reportingtoemployeenumber'], columns: {
    employeenumber: 'code', displayname: 'name', datejoined: 'dateOfJoining', reportingtoemployeenumber: 'managerCode', jobtitle: 'jobPosition', mobilephone: 'phone', workemail: 'workEmail', personalemail: 'email', location: 'workSite', employmenttype: 'employeeType',
  } },
  { tool: 'greytHR', marks: ['employeeno', 'reportingmanagerno', 'officialemailid'], columns: {
    employeeno: 'code', employeename: 'name', dateofjoining: 'dateOfJoining', reportingmanagerno: 'managerCode', designation: 'jobPosition', mobileno: 'phone', officialemailid: 'workEmail', personalemailid: 'email', location: 'workSite', category: 'employeeType',
  } },
  { tool: 'Zoho People', marks: ['reportingto', 'dateofjoining', 'workphone', 'emailaddress'], columns: {
    employeeid: 'code', dateofjoining: 'dateOfJoining', reportingto: 'managerCode', designation: 'jobPosition', workphone: 'phone', emailaddress: 'workEmail', personalemailaddress: 'email', location: 'workSite', employeetype: 'employeeType',
  } },
  { tool: 'Darwinbox', marks: ['directmanageremployeeid', 'dateofjoining', 'officeemailid'], columns: {
    employeeid: 'code', fullname: 'name', dateofjoining: 'dateOfJoining', directmanageremployeeid: 'managerCode', designation: 'jobPosition', mobilenumber: 'phone', officeemailid: 'workEmail', personalemailid: 'email', officelocation: 'workSite', employeetype: 'employeeType',
  } },
];

const flat = (h) => String(h || '').toLowerCase().replace(/[^a-z]/g, '');

/** The tool a sheet came from, when at least two of its tell-tale column names are there; else null. */
export function sheetFromTool(headers = []) {
  const have = new Set(headers.map(flat));
  let best = null;
  for (const t of OTHER_TOOLS) {
    const hits = t.marks.filter((m) => have.has(m)).length;
    if (hits >= 2 && (!best || hits > best.hits)) best = { tool: t.tool, hits, columns: t.columns };
  }
  return best;
}

/** Each column's field: our own names first, then the other tool's names. Never two columns to one field. */
export function guessImportColumns(headers = []) {
  const from = sheetFromTool(headers);
  const out = headers.map((h) => guessField(h) || (from ? from.columns[flat(h)] || '' : ''));
  const seen = new Set();
  return out.map((k) => { if (!k) return ''; if (seen.has(k)) return ''; seen.add(k); return k; });
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_WORDS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE_KEYS = ['dateOfJoining', 'dateOfBirth', 'probationEndDate', 'contractEndDate'];

/** Reads a sheet date the way the server does: 05/10/2026 is 5 October. Returns { y, m, d } or null. */
export function readSheetDate(value) {
  const t = String(value ?? '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return { y: +m[3], m: +m[2], d: +m[1] };
  m = t.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = t.match(/^(\d{1,2})[\s/.-]([A-Za-z]{3,9})[\s/.,-]+(\d{4})$/);
  if (m && MONTHS.includes(m[2].slice(0, 3).toLowerCase())) return { y: +m[3], m: MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, d: +m[1] };
  return null;
}

/** The first date in a mapped date column, as written and as read: { column, raw, words }. Null when none. */
export function dateExample(file, mapping) {
  if (!file?.rows?.length) return null;
  for (let i = 0; i < mapping.length; i += 1) {
    if (!DATE_KEYS.includes(mapping[i])) continue;
    for (const row of file.rows) {
      const raw = String(row[i] ?? '').trim();
      if (!raw) continue;
      const r = readSheetDate(raw);
      if (!r || r.m < 1 || r.m > 12 || r.d < 1 || r.d > 31) return { column: file.headers[i] || `Column ${i + 1}`, raw, words: null };
      return { column: file.headers[i] || `Column ${i + 1}`, raw, words: `${r.d} ${MONTH_WORDS[r.m - 1]} ${r.y}` };
    }
  }
  return null;
}

/** Map step: which tool the sheet came from, and how its dates are read. */
export function ImportReadNotes({ file, mapping }) {
  const from = sheetFromTool(file?.headers);
  const ex = dateExample(file, mapping);
  if (!from && !ex) return null;
  return (
    <div className="ui-import-notes space-y-1" role="note">
      {from ? <p className="text-sm">This looks like an export from {from.tool}; its columns are matched below. Check them before going on.</p> : null}
      {ex ? (
        ex.words
          ? <p className="text-sm">Dates are read day first: <span className="tabular-nums">{ex.raw}</span> in {ex.column} is <b className="tabular-nums">{ex.words}</b>. If that is wrong, fix the dates in the sheet first.</p>
          : <p className="text-sm ui-text-warn">{ex.column} has <span className="tabular-nums">{ex.raw}</span>, which does not read as a date. Use day/month/year, like 05/10/2026.</p>
      ) : null}
    </div>
  );
}

/** While the rows go in: a moving bar, the count, and a word to stay. */
export function ImportProgress({ rows }) {
  return (
    <div className="ui-import-progress space-y-1" role="status">
      <progress className="ui-progress w-full" aria-label={`Importing ${rows} rows`} />
      <p className="ui-caption">Importing {rows} {rows === 1 ? 'row' : 'rows'}. Stay on this page until it finishes.</p>
    </div>
  );
}
