/*
 * Round 65 picks (managers), worked out from the manager's own team rows in the browser:
 * teamcount A (people · joining · on notice), teamdue A (this month's probation ends, contract
 * ends and work anniversaries), teambalances A (person × leave type) and teamexport A (the
 * team as a spreadsheet). Nothing here asks the server for more than the lists it already gives.
 */

const monthEnd = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${iso.slice(0, 7)}-${String(last).padStart(2, '0')}`;
};
const day = (v) => (v ? String(v).slice(0, 10) : '');
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'Someone';
const possessive = (name) => `${firstName(name)}’s`;

/** The count line over My team: everyone still here, who is yet to join, who is serving notice. */
export function teamCounts(rows, today) {
  const here = (rows || []).filter((r) => r.status !== 'LEFT');
  const joining = here.filter((r) => day(r.dateOfJoining) > today).length;
  const leaving = here.filter((r) => r.status === 'ON_NOTICE').length;
  return { people: here.length - joining, joining, leaving };
}

const yearsWord = (n) => (n === 1 ? '1 year' : `${n} years`);

/** Dated things due for the team from today to the end of this month, earliest first. */
export function teamDue(rows, today) {
  const end = monthEnd(today);
  const out = [];
  for (const r of rows || []) {
    if (r.status === 'LEFT') continue;
    const prob = day(r.probationEndDate);
    if (prob && !r.confirmedOn && prob >= today && prob <= end) {
      out.push({ date: prob, id: r.id, kind: 'probation', text: `${possessive(r.name)} probation ends`, action: 'Give your view' });
    }
    const contract = day(r.contractEndDate);
    if (contract && contract >= today && contract <= end) {
      out.push({ date: contract, id: r.id, kind: 'contract', text: `${possessive(r.name)} contract ends`, action: 'Open' });
    }
    const joined = day(r.dateOfJoining);
    if (joined) {
      const years = Number(today.slice(0, 4)) - Number(joined.slice(0, 4));
      const date = `${today.slice(0, 4)}${joined.slice(4)}`;
      if (years >= 1 && joined.slice(5, 7) === today.slice(5, 7) && date >= today && date <= end) {
        out.push({ date, id: r.id, kind: 'anniversary', text: `${firstName(r.name)} completes ${yearsWord(years)}`, action: 'Open' });
      }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.text.localeCompare(b.text)));
}

/** The balances table limited to the team, sorted by one leave type (most left first) or by name. */
export function teamBalanceRows(balances, teamIds, sortType) {
  const ids = new Set(teamIds || []);
  const rows = (balances?.rows || []).filter((r) => ids.has(r.employeeId));
  const left = (r) => Number(r.balances?.[sortType]?.available ?? -Infinity);
  return [...rows].sort((a, b) => (sortType ? left(b) - left(a) : 0) || String(a.name).localeCompare(String(b.name)));
}

/* Excel reads a CSV as UTF-8 (₹, names in Indian scripts) only with this mark in front. */
const BOM = String.fromCharCode(0xfeff);

const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The team as CSV (opens in Excel): name, code, role, department, phone, work email and leave left. */
export function teamCsv(rows, balances) {
  const types = balances?.types || [];
  const byId = new Map((balances?.rows || []).map((r) => [r.employeeId, r.balances || {}]));
  const head = ['Name', 'Employee ID', 'Role', 'Department', 'Phone', 'Work email', ...types.map((t) => `${t.name} left`)];
  const lines = (rows || []).filter((r) => r.status !== 'LEFT').map((r) => [
    r.name, r.code, r.designation, r.department, r.phone, r.workEmail,
    ...types.map((t) => byId.get(r.id)?.[t.id]?.available ?? ''),
  ]);
  return `${BOM}${[head, ...lines].map((l) => l.map(cell).join(',')).join('\n')}\n`;
}
