import { notify } from '@ui/components/ui/notify';
import { escapeHtml } from '@ui/utils/html';

/**
 * Reader trust (O-11) shared by the records list, the evidence drawer and the
 * printable page: the three levels, and the printed evidence page itself.
 */
export const TRUST = {
  TRUSTED: { label: 'Trusted', pill: 'ui-pill-pos' },
  CHECK: { label: 'Check', pill: 'ui-pill-warn' },
  MANUAL: { label: 'Manual', pill: 'ui-pill-neutral' },
};

const COLUMNS = [
  ['date', 'Day'], ['punched', 'Punched (IST)'], ['received', 'Received (IST)'], ['delayMinutes', 'Delay (min)'], ['direction', 'Direction'],
  ['readerId', 'Reader ID'], ['serialNumber', 'Serial'], ['reader', 'Reader'], ['method', 'Method'], ['geofence', 'Work site'],
  ['dayTrust', 'Day trust'], ['dayReasons', 'Why'],
];

/** A printed document: black on white on purpose, like the printed registers (DESIGN.md, printed documents). */
export function printEvidence(e) {
  const w = window.open('', '_blank', 'noopener=no');
  if (!w) {
    notify.error('Allow pop-ups for this site to print.');
    return false;
  }
  const who = `${e.employee.name}${e.employee.code ? ` (${e.employee.code})` : ''}`;
  const head = COLUMNS.map(([k, label]) => `<th${k === 'delayMinutes' ? ' class="r"' : ''}>${escapeHtml(label)}</th>`).join('');
  const body = e.rows
    .map((r) => `<tr>${COLUMNS.map(([k]) => `<td${k === 'delayMinutes' ? ' class="r"' : ''}>${escapeHtml(k === 'dayTrust' ? TRUST[r[k]]?.label || '' : r[k])}</td>`).join('')}</tr>`)
    .join('');
  const s = e.summary;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Attendance evidence ${escapeHtml(who)} ${escapeHtml(e.period.from)} to ${escapeHtml(e.period.to)}</title>
<style>body{font:11px Inter,system-ui,sans-serif;margin:16px;color:#111}h1{font-size:16px;margin:0}h2{font-size:12px;font-weight:400;margin:2px 0 10px;color:#444}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:3px 5px;text-align:left;vertical-align:top}th{background:#f2f2f2}.r{text-align:right;font-variant-numeric:tabular-nums}
dl{display:flex;gap:18px;margin:0 0 10px}dt{color:#444}dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums}.n{color:#444;margin:8px 0 0}@page{size:landscape;margin:10mm}</style></head><body>
<h1>Attendance evidence</h1><h2>${escapeHtml(who)}${e.employee.department ? ` · ${escapeHtml(e.employee.department)}` : ''} · ${escapeHtml(e.period.from)} to ${escapeHtml(e.period.to)} · printed ${escapeHtml(new Date().toLocaleString('en-IN'))}</h2>
<dl><div><dt>Punches</dt><dd>${s.punches}</dd></div><div><dt>Days</dt><dd>${s.days}</dd></div><div><dt>Trusted</dt><dd>${s.trusted}</dd></div><div><dt>Check</dt><dd>${s.check}</dd></div><div><dt>Manual</dt><dd>${s.manual}</dd></div></dl>
<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${COLUMNS.length}">No punches in this period.</td></tr>`}</tbody></table>
<p class="n">Trusted: every punch came from a registered reader that was online with its clock right, and reached CLOR in time. Check: a punch needs a look (see Why). Manual: the day was written by hand, an import, a correction or leave. Times are Indian Standard Time.</p></body></html>`);
  w.document.close();
  w.focus();
  w.print();
  return true;
}
