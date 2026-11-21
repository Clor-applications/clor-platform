import React from 'react';

/**
 * Round 50 pick "duecalendar" B: the next five statutory dues on Payroll
 * home, as a short list. The dates are the law's standing dates, worked out
 * here; they do not say whether a payment was made (that needs payments the
 * server does not record yet).
 *
 *  - TDS deposit: the 7th of the next month; March's by 30 April.
 *  - PF (return and payment) and ESI contribution: the 15th of the next month.
 *  - TDS return (24Q): 31 July, 31 October, 31 January, 31 May.
 *  - Form 16 to staff: 15 June.
 *
 * Professional tax dates differ by state, so PT is left out rather than shown
 * wrong.
 */
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The dues from `fromIso` (YYYY-MM-DD) on, soonest first, `count` of them. */
export function nextDues(fromIso, count = 5) {
  const [fy, fm] = String(fromIso).split('-').map(Number);
  if (!fy || !fm) return [];
  const out = [];
  for (let k = -2; k < 14; k += 1) {
    /* Wages of month w in year wy are paid over in the month after. */
    const idx = fm - 1 + k;
    const w = ((idx % 12) + 12) % 12 + 1;
    const wy = fy + Math.floor(idx / 12);
    const ny = w === 12 ? wy + 1 : wy;
    const nm = w === 12 ? 1 : w + 1;
    const wages = `${MONTH[w - 1]} ${wy}`;
    out.push({ key: `tds-${wy}-${w}`, date: w === 3 ? iso(ny, 4, 30) : iso(ny, nm, 7), what: `TDS deposit for ${wages}` });
    out.push({ key: `pf-${wy}-${w}`, date: iso(ny, nm, 15), what: `PF return and payment for ${wages}` });
    out.push({ key: `esi-${wy}-${w}`, date: iso(ny, nm, 15), what: `ESI contribution for ${wages}` });
  }
  for (let y = fy - 1; y <= fy + 1; y += 1) {
    out.push({ key: `24q1-${y}`, date: iso(y, 7, 31), what: 'TDS return (24Q), April to June' });
    out.push({ key: `24q2-${y}`, date: iso(y, 10, 31), what: 'TDS return (24Q), July to September' });
    out.push({ key: `24q3-${y}`, date: iso(y, 1, 31), what: 'TDS return (24Q), October to December' });
    out.push({ key: `24q4-${y}`, date: iso(y, 5, 31), what: 'TDS return (24Q), January to March' });
    out.push({ key: `f16-${y}`, date: iso(y, 6, 15), what: 'Form 16 to every employee' });
  }
  return out
    .filter((d) => d.date >= fromIso)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, count);
}

export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const shown = (d) => {
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTH[m - 1]} ${y}`;
};
const inWords = (n) => (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`);

/* Light accents on Home (DESIGN.md): a soft tag naming what each due is about. */
const SUBJECT_TONE = { TDS: 'info', PF: 'mint', ESI: 'lilac', 'Form 16': 'peach' };
function subjectOf(key) {
  if (key.startsWith('pf-')) return 'PF';
  if (key.startsWith('esi-')) return 'ESI';
  if (key.startsWith('f16-')) return 'Form 16';
  return 'TDS';
}

export default function StatutoryDues({ today }) {
  const dues = nextDues(today);
  if (!dues.length) return null;
  return (
    <section className="ui-dues" aria-labelledby="ui-dues-h">
      <h2 id="ui-dues-h" className="ui-sec-head">Next dues</h2>
      <ol className="ui-dues-list">
        {dues.map((d) => {
          const left = daysBetween(today, d.date);
          return (
            <li key={d.key} className="ui-dues-row">
              <span className="ui-dues-what"><span className="ui-subject" data-tone={SUBJECT_TONE[subjectOf(d.key)]}>{subjectOf(d.key)}</span> {d.what}</span>
              <span className="ui-dues-when tabular-nums">
                {shown(d.date)} · <span className={left <= 3 ? 'ui-text-warn' : 'ui-muted'}>{inWords(left)}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="ui-caption">Professional tax dates differ by state and are not listed.</p>
    </section>
  );
}
