import React from 'react';
import { productBySlug } from '../site.js';
import { Mark } from './Brand.jsx';
import { Reveal } from './Reveal.jsx';

/*
 * CLOR screens drawn in HTML and CSS with sample data (a fictional "Anand
 * Traders", Pune). Each figure shows one moment in one product: not a whole
 * app window, just the record a person would be looking at, set in a quiet
 * frame with a small title bar. The type inside scales with the column the
 * figure sits in, so it stays readable at any width. The product's own
 * accent marks the current tab and nothing else; the one orange figure in a
 * document is the total. Real screenshots replace them once captured
 * (CONTENT_CHECKLIST.md).
 */

export const inr = (n) => `₹${Math.abs(n).toLocaleString('en-IN')}`;
const signed = (n) => (n < 0 ? `− ${inr(n)}` : inr(n));

/* ------------------------------------------------------------------ frame */
export function Fig({ slug, title, right, n, caption, children, className = '', reveal = true, bare = false }) {
  const p = productBySlug(slug);
  const body = (
    <figure className={`fig ${className}`.trim()} data-product={slug} style={{ '--acc': p.accent }}>
      <div className="fig-frame" role="img" aria-label={`${p.name}: ${title}, drawn with sample data`}>
        <div className="fig-bar">
          <Mark product={p} size={18} />
          <span className="fig-app">{p.name}</span>
          <span className="fig-where">{title}</span>
          {right ? <span className="fig-right">{right}</span> : null}
        </div>
        <div className="fig-body">{children}</div>
      </div>
      {caption === false || bare ? null : (
        <figcaption className="fig-cap">
          {n ? <span className="fig-n">Fig. {n}</span> : null}
          <span>{caption || `CLOR ${p.name}, drawn with sample data.`}</span>
        </figcaption>
      )}
    </figure>
  );
  return reveal ? <Reveal>{body}</Reveal> : body;
}

/* ------------------------------------------------------------- primitives */
export function FigHead({ title, sub, children }) {
  return (
    <div className="f-head">
      <div>
        <p className="f-title">{title}</p>
        {sub ? <p className="f-k">{sub}</p> : null}
      </div>
      {children ? <div className="f-pills">{children}</div> : null}
    </div>
  );
}

export function Pill({ tone, children }) {
  return <span className={`f-pill${tone ? ` f-pill--${tone}` : ''}`}>{children}</span>;
}

export function Tabs({ items, current }) {
  return (
    <div className="f-tabs" aria-hidden="true">
      {items.map((t) => (
        <span key={t} className={t === current ? 'is-current' : ''}>
          {t}
        </span>
      ))}
    </div>
  );
}

/** Key and value pairs, two or four across. */
export function Kv({ items, cols = 2 }) {
  return (
    <dl className={`f-kv f-kv--${cols}`}>
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A table: cols are strings or { h, num }; rows are arrays of cells. */
export function Tbl({ cols, rows, className = '' }) {
  const col = (c) => (typeof c === 'string' ? { h: c } : c);
  return (
    <table className={`f-table ${className}`.trim()}>
      <thead>
        <tr>
          {cols.map((c, i) => (
            <th key={i} className={col(c).num ? 'num' : undefined}>
              {col(c).h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={r.strong ? 'is-strong' : undefined}>
            {r.map((cell, j) => (
              <td key={j} className={col(cols[j]).num ? 'num' : undefined}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A row of figures with hairlines between, no boxes. */
export function Stats({ items }) {
  return (
    <ul className="f-stats">
      {items.map(([v, l]) => (
        <li key={l}>
          <strong className="num">{v}</strong>
          <span>{l}</span>
        </li>
      ))}
    </ul>
  );
}

/** A checklist: [text, meta, state] with state done | todo | warn. */
export function Checks({ items }) {
  return (
    <ul className="f-checks">
      {items.map(([t, meta, state]) => (
        <li key={t} className={`is-${state || 'todo'}`}>
          <span className="f-tick" aria-hidden="true" />
          <span className="f-check-text">{t}</span>
          {meta ? <span className="f-k">{meta}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Totals under a table: rows then the one that matters, in orange. */
export function Totals({ rows, total, note }) {
  return (
    <div className="f-totals">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <span>{k}</span>
          <span className="num">{v}</span>
        </React.Fragment>
      ))}
      <strong className="f-total-k">{total[0]}</strong>
      <strong className="f-total num">{total[1]}</strong>
      {note ? <span className="f-k f-totals-note">{note}</span> : null}
    </div>
  );
}

/** Dated lines of who did what. */
export function Log({ items }) {
  return (
    <ul className="f-log">
      {items.map(([when, text]) => (
        <li key={when + text}>
          <span className="f-k num">{when}</span>
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

export function Dot({ tone }) {
  return <span className={`f-dot${tone ? ` f-dot--${tone}` : ''}`} aria-hidden="true" />;
}

/* ================================================================== Books */
export function InvoiceFig(props) {
  const lines = [
    ['Steel brackets, 40 mm', '7326', 120, 85],
    ['Hinges, heavy duty', '8302', 60, 140],
    ['Fitting labour', '9987', 1, 2400],
  ];
  const sub = lines.reduce((s, [, , q, r]) => s + q * r, 0);
  const half = Math.round(sub * 0.09);
  return (
    <Fig slug="books" title="Sales / Tax invoice" right="Anand Traders" {...props}>
      <FigHead title="Tax invoice INV-2026-0412" sub="12 October 2026 · Due 11 November 2026">
        <Pill tone="ok">e-Invoice · IRN 7a3f…c91e</Pill>
        <Pill>Unpaid</Pill>
      </FigHead>
      <Kv
        items={[
          ['Bill to', <>Mehta Interiors<br />Kothrud, Pune 411038<br /><span className="f-k">GSTIN 27AABCM4512F1Z7</span></>],
          ['Place of supply', <>Maharashtra (27)<br /><span className="f-k">Intra-state: CGST and SGST</span></>],
        ]}
      />
      <Tbl
        cols={['Item', 'HSN/SAC', { h: 'Qty', num: true }, { h: 'Rate', num: true }, { h: 'Amount', num: true }]}
        rows={lines.map(([n, h, q, r]) => [n, <span className="f-k">{h}</span>, q, inr(r), inr(q * r)])}
        className="f-table--doc"
      />
      <Totals rows={[['Taxable value', inr(sub)], ['CGST 9%', inr(half)], ['SGST 9%', inr(half)]]} total={['Total', inr(sub + 2 * half)]} note="Posted to Sales and Output GST on save" />
    </Fig>
  );
}

export function SalesListFig(props) {
  return (
    <Fig slug="books" title="Sales / Documents" {...props}>
      <Tabs items={['Quotations', 'Orders', 'Invoices', 'Credit notes', 'Recurring']} current="Invoices" />
      <Tbl
        cols={['Document', 'Customer', { h: 'Amount', num: true }, 'Status']}
        rows={[
          ['INV-2026-0412', 'Mehta Interiors', inr(24780), <><Dot /> Unpaid</>],
          ['INV-2026-0411', 'Kulkarni Builders', inr(1_18_000), <><Dot tone="ok" /> Paid by UPI</>],
          ['INV-2026-0410', 'Sahyadri Hospital', inr(56_640), <><Dot tone="ok" /> Paid</>],
          ['QTN-2026-0098', 'Deshpande & Sons', inr(2_12_400), <><Dot tone="warn" /> Awaiting approval</>],
        ]}
      />
      <p className="f-k">Quotations above ₹2,00,000 wait for the owner’s approval before they become invoices.</p>
    </Fig>
  );
}

export function GstrFig(props) {
  const rows = [
    ['B2B invoices', 142, 18_40_500],
    ['B2C invoices', 316, 4_12_300],
    ['Credit notes', 6, -38_200],
    ['Exports and SEZ', 2, 96_000],
  ];
  const taxable = rows.reduce((s, [, , v]) => s + v, 0);
  return (
    <Fig slug="books" title="GST / GSTR-1" {...props}>
      <FigHead title="GSTR-1, October 2026" sub="GSTIN 27AAKFA4821L1Z3 · Pune branch">
        <Pill tone="ok">Ready to file</Pill>
      </FigHead>
      <Stats items={[['466', 'Documents'], ['142', 'With IRN'], ['38', 'e-Way bills'], ['0', 'Missing GSTIN']]} />
      <Tbl
        cols={['Section', { h: 'Count', num: true }, { h: 'Taxable value', num: true }, { h: 'Tax', num: true }]}
        rows={rows.map(([k, n, v]) => [k, n, signed(v), signed(Math.round(v * 0.18))])}
      />
      <Totals rows={[['Taxable value', inr(taxable)]]} total={['Tax on outward supplies', inr(Math.round(taxable * 0.18))]} note="GSTR-3B uses the same figures" />
    </Fig>
  );
}

export function StockFig(props) {
  return (
    <Fig slug="books" title="Inventory / Steel brackets, 40 mm" {...props}>
      <FigHead title="Steel brackets, 40 mm" sub="HSN 7326 · Valued at weighted average">
        <Pill>1,460 in stock</Pill>
      </FigHead>
      <Tbl
        cols={['Warehouse', 'Batch', { h: 'Qty', num: true }, { h: 'Value', num: true }]}
        rows={[
          ['Pune, Bhosari', 'B-2026-31', 920, inr(78_200)],
          ['Pune, Bhosari', 'B-2026-28', 340, inr(28_560)],
          ['Nashik', 'B-2026-30', 200, inr(17_000)],
        ]}
      />
      <Kv items={[['Last purchase', '2 Oct 2026, 500 at ₹85'], ['Reorder at', '400, Bhosari']]} />
    </Fig>
  );
}

export function BankFig(props) {
  return (
    <Fig slug="books" title="Banking / Reconciliation" {...props}>
      <FigHead title="HDFC current account, October 2026" sub="Statement balance ₹8,42,116 · Book balance ₹8,42,116">
        <Pill tone="ok">Reconciled</Pill>
      </FigHead>
      <Checks
        items={[
          ['NEFT from Kulkarni Builders, ₹1,18,000', 'INV-2026-0411', 'done'],
          ['UPI from Sahyadri Hospital, ₹56,640', 'INV-2026-0410', 'done'],
          ['Salary payment, ₹12,69,700', 'Payroll, October', 'done'],
          ['Bank charges, ₹590', 'Needs a ledger', 'warn'],
        ]}
      />
    </Fig>
  );
}

export function PnlFig(props) {
  return (
    <Fig slug="books" title="Reports / Profit and loss" {...props}>
      <FigHead title="Profit and loss, April to October 2026" sub="All branches · Accrual" />
      <Tbl
        cols={['', { h: 'This year', num: true }, { h: 'Last year', num: true }]}
        rows={[
          ['Sales', inr(1_42_80_500), inr(1_18_20_300)],
          ['Cost of goods sold', signed(-84_12_000), signed(-71_90_400)],
          ['Salaries', signed(-38_60_200), signed(-31_10_800)],
          ['Other expenses', signed(-9_84_100), signed(-8_22_600)],
          Object.assign(['Net profit', inr(10_24_200), inr(6_96_500)], { strong: true }),
        ]}
      />
    </Fig>
  );
}

/* ================================================================= People */
export function EmployeeFig(props) {
  return (
    <Fig slug="people" title="Employees / Kavya Iyer" {...props}>
      <div className="f-person">
        <span className="f-avatar" aria-hidden="true">
          KI
        </span>
        <div>
          <p className="f-title">Kavya Iyer</p>
          <p className="f-k">Accounts executive · Finance · Pune office · E042</p>
        </div>
        <Pill tone="ok">Active</Pill>
      </div>
      <Tabs items={['Profile', 'Job', 'Documents', 'Time', 'History']} current="Profile" />
      <Kv cols={4} items={[['Joined', '3 June 2024'], ['Manager', 'Rohit Anand'], ['Employment', 'Full time, confirmed'], ['UAN', '1012 4456 7890']]} />
      <p className="f-sub">Joining checklist · 4 of 6 done</p>
      <Checks
        items={[
          ['Offer letter signed', 'HR', 'done'],
          ['PAN and Aadhaar collected', 'HR', 'done'],
          ['Bank details verified', 'Finance', 'done'],
          ['Enrolled on the gate reader', 'Admin', 'done'],
          ['Laptop issued', 'IT', 'todo'],
          ['Added to health insurance', 'HR', 'todo'],
        ]}
      />
    </Fig>
  );
}

export function LeaveFig(props) {
  return (
    <Fig slug="people" title="Time / Leave balances" {...props}>
      <FigHead title="Kavya Iyer · Leave, 2026" sub="Policy: Pune office, confirmed staff" />
      <Tbl
        cols={['Type', { h: 'Opening', num: true }, { h: 'Taken', num: true }, { h: 'Balance', num: true }]}
        rows={[
          ['Earned leave', 18, 7, 11],
          ['Casual leave', 8, 5, 3],
          ['Sick leave', 7, 2, 5],
        ]}
      />
      <p className="f-sub">Waiting for Rohit Anand</p>
      <Checks items={[['Earned leave, 18 to 20 November, 3 days', 'Asked from the employee app, 10 Nov', 'warn']]} />
    </Fig>
  );
}

export function DocumentsFig(props) {
  return (
    <Fig slug="people" title="Documents / Expiring soon" {...props}>
      <FigHead title="Documents expiring in 90 days" sub="Reminders go to HR and the employee, 30 days before">
        <Pill tone="warn">3 expiring</Pill>
      </FigHead>
      <Tbl
        cols={['Employee', 'Document', 'Expires', 'Who may see it']}
        rows={[
          ['Kavya Iyer', 'Passport', '14 Dec 2026', 'HR only'],
          ['Arjun Nair', 'Driving licence', '2 Feb 2027', 'HR, manager'],
          ['Priya Menon', 'Work permit, Baner site', '28 Jan 2027', 'HR, Admin'],
        ]}
      />
    </Fig>
  );
}

export function ExitFig(props) {
  return (
    <Fig slug="people" title="Employees / Arjun Nair / Leaving" {...props}>
      <FigHead title="Leaving checklist · Arjun Nair" sub="Last working day 30 November 2026 · Notice 60 days">
        <Pill>5 of 7 done</Pill>
      </FigHead>
      <Checks
        items={[
          ['Resignation accepted', 'Manager', 'done'],
          ['Knowledge handover', 'Manager', 'done'],
          ['Laptop and ID card returned', 'IT', 'done'],
          ['Access ended on readers and apps', 'Admin', 'done'],
          ['Experience letter issued', 'HR', 'done'],
          ['Final settlement', 'Handed to Payroll', 'todo'],
          ['Gratuity and leave encashment', 'Payroll, November run', 'todo'],
        ]}
      />
    </Fig>
  );
}

export function OrgFig(props) {
  return (
    <Fig slug="people" title="Org chart / Finance" {...props}>
      <FigHead title="Finance · 6 people" sub="Reporting lines come from each record" />
      <ul className="f-tree">
        <li>
          <span className="f-v">Rohit Anand</span> <span className="f-k">Owner</span>
          <ul>
            <li>
              <span className="f-v">Meera Pillai</span> <span className="f-k">Finance head</span>
              <ul>
                <li>
                  <span className="f-v">Kavya Iyer</span> <span className="f-k">Accounts executive</span>
                </li>
                <li>
                  <span className="f-v">Nikhil Shah</span> <span className="f-k">Accounts executive</span>
                </li>
                <li>
                  <span className="f-v">Deepa Rao</span> <span className="f-k">Payroll</span>
                </li>
              </ul>
            </li>
            <li>
              <span className="f-v">Sharma &amp; Co</span> <span className="f-k">Chartered accountants, outside</span>
            </li>
          </ul>
        </li>
      </ul>
    </Fig>
  );
}

/* ============================================================= Attendance */
export function TodayFig(props) {
  const rows = [
    ['Kavya Iyer', 'General 9:30–18:30', '09:24', 'Main gate reader', 'Present', 'ok'],
    ['Arjun Nair', 'General 9:30–18:30', '09:52', 'Main gate reader', 'Late 22 min', 'warn'],
    ['Priya Menon', 'Field 10:00–19:00', '10:05', 'Phone · Baner site', 'Present', 'ok'],
    ['Suresh Babu', 'General 9:30–18:30', '—', '', 'Casual leave', 'off'],
    ['Meera Pillai', 'Second 14:00–22:00', '—', '', 'Not yet in', ''],
  ];
  return (
    <Fig slug="attendance" title="Today / Tuesday 10 November 2026" {...props}>
      <Stats items={[['42', 'Present'], ['3', 'Late'], ['4', 'On leave'], ['2', 'Not yet in']]} />
      <Tbl
        cols={['Employee', 'Shift', 'In', 'Status']}
        rows={rows.map(([n, s, t, from, st, tone]) => [
          <span className="f-v">{n}</span>,
          <span className="f-k">{s}</span>,
          <>
            <span className="num">{t}</span>
            {from ? <span className="f-k f-from">{from}</span> : null}
          </>,
          <>
            <Dot tone={tone} /> {st}
          </>,
        ])}
      />
    </Fig>
  );
}

export function ReadersFig(props) {
  return (
    <Fig slug="attendance" title="Readers" {...props}>
      <FigHead title="Readers · 4 connected" sub="Punches arrive as they happen">
        <Pill tone="ok">All online</Pill>
      </FigHead>
      <Tbl
        cols={['Reader', 'Where', 'Last punch', 'Enrolled']}
        rows={[
          [<><Dot tone="ok" /> ZKTeco F22</>, 'Main gate, Bhosari', '10:41 today', '48'],
          [<><Dot tone="ok" /> eSSL X990</>, 'Workshop door', '10:12 today', '31'],
          [<><Dot tone="ok" /> Hikvision face</>, 'Nashik office', '09:58 today', '12'],
          [<><Dot tone="ok" /> Matrix Cosec</>, 'Stores, via on-site connector', '08:30 today', '9'],
        ]}
      />
    </Fig>
  );
}

export function PhonePunchFig(props) {
  return (
    <Fig slug="attendance" title="Punches / Priya Menon" {...props}>
      <FigHead title="Phone punch · Priya Menon" sub="Tuesday 10 November, 10:05">
        <Pill tone="ok">Inside Baner site</Pill>
      </FigHead>
      <Kv cols={2} items={[['Site', 'Baner site, 200 m geofence'], ['Distance from centre', '38 m'], ['Selfie', 'Taken, kept 30 days'], ['Device', 'Her own phone, CLOR employee app']]} />
      <p className="f-sub">Outside a site</p>
      <p className="f-k">A punch away from every site is kept, marked, and waits for the manager’s approval before it counts.</p>
    </Fig>
  );
}

export function ShiftsFig(props) {
  return (
    <Fig slug="attendance" title="Shifts / Roster, week of 9 November" {...props}>
      <Tbl
        cols={['Employee', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']}
        rows={[
          ['Kavya Iyer', 'G', 'G', 'G', 'G', 'G', 'Off'],
          ['Meera Pillai', 'S2', 'S2', 'S2', 'Off', 'S2', 'S2'],
          ['Priya Menon', 'F', 'F', 'F', 'F', 'F', 'F'],
          ['Rahul Verma', 'Off', 'G', 'G', 'G', 'G', 'G'],
        ]}
        className="f-table--tight"
      />
      <Kv cols={2} items={[['G · General', '9:30 to 18:30, late after 15 min'], ['S2 · Second', '14:00 to 22:00, overtime after 9 h'], ['F · Field', '10:00 to 19:00, phone punch']]} />
    </Fig>
  );
}

export function MonthCloseFig(props) {
  return (
    <Fig slug="attendance" title="Month close / October 2026" {...props}>
      <FigHead title="October 2026" sub="48 employees · 26 working days">
        <Pill tone="ok">Closed · handed to Payroll</Pill>
      </FigHead>
      <Stats items={[['1,214', 'Paid days'], ['86 h', 'Overtime'], ['31', 'Leave days'], ['0', 'Open corrections']]} />
      <Tbl
        cols={['Employee', { h: 'Paid days', num: true }, { h: 'OT hours', num: true }, { h: 'Leave', num: true }, { h: 'LOP', num: true }]}
        rows={[
          ['Kavya Iyer', 26, 0, 1, 0],
          ['Arjun Nair', 25, 6, 0, 1],
          ['Priya Menon', 26, 4, 0, 0],
        ]}
      />
    </Fig>
  );
}

/* ================================================================ Payroll */
export function PayRunFig(props) {
  const gross = 14_82_400;
  const ded = [
    ['PF, employee 12%', 1_12_680],
    ['ESI, employee 0.75%', 6_120],
    ['Professional tax', 9_600],
    ['TDS', 84_300],
  ];
  const net = gross - ded.reduce((s, [, v]) => s + v, 0);
  return (
    <Fig slug="payroll" title="Pay runs / October 2026" {...props}>
      <FigHead title="Pay run, October 2026" sub="48 employees · 26 working days · Pay day 1 November">
        <Pill tone="ok">Locked · journal posted to Books</Pill>
      </FigHead>
      <Tbl
        cols={['Employee', { h: 'Gross', num: true }, { h: 'PF', num: true }, { h: 'TDS', num: true }, { h: 'Net pay', num: true }]}
        rows={[
          ['Kavya Iyer', inr(37_000), inr(2_520), '—', inr(34_280)],
          ['Arjun Nair', inr(62_500), inr(1_800), inr(3_900), inr(56_600)],
          ['Priya Menon', inr(48_000), inr(1_800), inr(1_250), inr(44_750)],
          [<span className="f-k">45 more</span>, '', '', '', ''],
        ]}
        className="f-table--doc"
      />
      <Totals rows={[['Gross earnings', inr(gross)], ...ded.map(([k, v]) => [k, `− ${inr(v)}`])]} total={['Net pay to 48 bank accounts', inr(net)]} note="Employer PF and ESI paid separately: ₹1,39,200" />
    </Fig>
  );
}

export function StructureFig(props) {
  return (
    <Fig slug="payroll" title="Salary structures / Staff, Pune" {...props}>
      <FigHead title="Staff, Pune · Kavya Iyer" sub="Revised 1 April 2026 · CTC ₹5,10,000 a year" />
      <Tbl
        cols={['Component', 'Rule', { h: 'Monthly', num: true }]}
        rows={[
          ['Basic', '50% of CTC', inr(21_250)],
          ['House rent allowance', '40% of basic', inr(8_500)],
          ['Conveyance', 'Fixed', inr(1_600)],
          ['Special allowance', 'Balance', inr(5_650)],
          Object.assign(['Gross', '', inr(37_000)], { strong: true }),
        ]}
      />
      <p className="f-k">PF on basic, capped at ₹15,000 wages. ESI applies below ₹21,000 gross.</p>
    </Fig>
  );
}

export function StatutoryFig(props) {
  return (
    <Fig slug="payroll" title="Statutory / October 2026" {...props}>
      <FigHead title="Statutory, October 2026" sub="Filed from the locked payslips" />
      <Tbl
        cols={['Return', 'Due', { h: 'Amount', num: true }, 'File']}
        rows={[
          ['PF ECR', '15 November', inr(2_51_880), <><Dot tone="ok" /> Ready</>],
          ['ESI contribution', '15 November', inr(32_640), <><Dot tone="ok" /> Ready</>],
          ['Professional tax, Maharashtra', '30 November', inr(9_600), <><Dot tone="ok" /> Ready</>],
          ['TDS on salary, 24Q', '31 January', inr(84_300), <><Dot /> Quarter open</>],
          ['Form 16', 'By 15 June', '48 employees', <><Dot /> Year end</>],
        ]}
      />
    </Fig>
  );
}

export function PayslipFig(props) {
  return (
    <Fig slug="payroll" title="Payslips / Kavya Iyer, October 2026" {...props}>
      <FigHead title="Payslip, October 2026" sub="Kavya Iyer · E042 · UAN 1012 4456 7890 · 26 paid days">
        <Pill tone="ok">In her app</Pill>
      </FigHead>
      <div className="f-cols">
        <Tbl cols={['Earnings', { h: '', num: true }]} rows={[['Basic', inr(21_250)], ['House rent allowance', inr(8_500)], ['Conveyance', inr(1_600)], ['Special allowance', inr(5_650)]]} />
        <Tbl cols={['Deductions', { h: '', num: true }]} rows={[['PF, 12%', inr(2_520)], ['ESI', '—'], ['Professional tax', inr(200)], ['TDS', '—']]} />
      </div>
      <Totals rows={[['Gross', inr(37_000)], ['Deductions', `− ${inr(2_720)}`]]} total={['Net pay', inr(34_280)]} note="Rupees thirty-four thousand two hundred and eighty only" />
    </Fig>
  );
}

export function JournalFig(props) {
  return (
    <Fig slug="payroll" title="Accounting / Journal, October 2026" {...props}>
      <FigHead title="Salary journal, October 2026" sub="Posted to Books when the run was locked, 1 November">
        <Pill tone="ok">Posted</Pill>
      </FigHead>
      <Tbl
        cols={['Ledger', { h: 'Debit', num: true }, { h: 'Credit', num: true }]}
        rows={[
          ['Salaries and wages', inr(14_82_400), ''],
          ['Employer PF and ESI', inr(1_39_200), ''],
          ['PF payable', '', inr(2_51_880)],
          ['ESI payable', '', inr(32_640)],
          ['Professional tax payable', '', inr(9_600)],
          ['TDS payable', '', inr(84_300)],
          ['Salaries payable', '', inr(12_43_180)],
        ]}
      />
    </Fig>
  );
}

/* ============================================================== Workspace */
export function UsersFig(props) {
  return (
    <Fig slug="workspace" title="Access / Users and roles" right="Rohit Anand" {...props}>
      <FigHead title="Users and roles" sub="Anand Traders · Anand Exports LLP · 2 companies, 3 branches">
        <Pill>4 users · 1 invitation open</Pill>
      </FigHead>
      <Tbl
        cols={['Person', 'Role', 'Sees']}
        rows={[
          [<span className="f-v">Rohit Anand</span>, 'Owner', 'All products, both companies'],
          [<span className="f-v">Kavya Iyer</span>, 'Accountant', 'Books, Payroll · Anand Traders'],
          [<span className="f-v">Sharma &amp; Co, CA</span>, 'Accountant', <>Books · Anand Traders <Pill>Until 31 Mar 2027</Pill></>],
          [<span className="f-v">Priya Menon</span>, 'Manager', 'People, Attendance · her team'],
        ]}
      />
      <p className="f-sub">Audit trail</p>
      <Log
        items={[
          ['10 Nov, 09:14', <><b>Rohit Anand</b> changed Kavya Iyer’s role in Anand Traders from Staff to Accountant.</>],
          ['1 Nov, 11:02', <><b>Kavya Iyer</b> locked the pay run for October 2026; its journal was posted to Books.</>],
        ]}
      />
    </Fig>
  );
}

export function CompaniesFig(props) {
  return (
    <Fig slug="workspace" title="Companies and branches" right="Rohit Anand" {...props}>
      <FigHead title="Your companies" sub="Switch from the company menu, without signing out" />
      <Tbl
        cols={['Company', 'Branch', 'GSTIN', 'Products on']}
        rows={[
          [<span className="f-v">Anand Traders</span>, 'Pune, Bhosari', '27AAKFA4821L1Z3', 'Books, People, Payroll'],
          ['', 'Nashik', '27AAKFA4821L2Z2', 'Books, Attendance'],
          [<span className="f-v">Anand Exports LLP</span>, 'Pune, Baner', '27AAQFA9930C1ZP', 'Books'],
        ]}
      />
    </Fig>
  );
}

export function OutsideAccessFig(props) {
  return (
    <Fig slug="workspace" title="Access / Outside access" right="Rohit Anand" {...props}>
      <FigHead title="Sharma & Co, chartered accountants" sub="Invited 28 October 2026 · accepted the same day">
        <Pill>Ends 31 March 2027</Pill>
      </FigHead>
      <Kv cols={2} items={[['Company', 'Anand Traders'], ['Products', 'Books only'], ['Role', 'Accountant: post entries, no payments'], ['Signs in with', 'Their own CLOR login']]} />
      <p className="f-k">Change the role or end the access at any time. Everything they change is in your audit trail with their name on it.</p>
    </Fig>
  );
}

export function AuditFig(props) {
  return (
    <Fig slug="workspace" title="Audit trail" right="Rohit Anand" {...props}>
      <FigHead title="Audit trail · Anand Traders" sub="Every change, in plain words" />
      <Log
        items={[
          ['10 Nov, 09:14', <><b>Rohit Anand</b> changed Kavya Iyer’s role from Staff to Accountant.</>],
          ['9 Nov, 17:31', <><b>Priya Menon</b> approved Arjun Nair’s missed punch for 9 November.</>],
          ['1 Nov, 11:02', <><b>Kavya Iyer</b> locked the pay run for October 2026; its journal was posted to Books.</>],
          ['28 Oct, 16:40', <><b>Rohit Anand</b> invited Sharma &amp; Co to Books as Accountant, until 31 March 2027.</>],
          ['12 Oct, 10:05', <><b>Kavya Iyer</b> raised tax invoice INV-2026-0412 for Mehta Interiors, ₹24,780.</>],
        ]}
      />
    </Fig>
  );
}

export function SsoFig(props) {
  return (
    <Fig slug="workspace" title="Access / Single sign-on" right="Rohit Anand" {...props}>
      <FigHead title="Single sign-on" sub="Anand Traders signs in through Google Workspace">
        <Pill tone="ok">On</Pill>
      </FigHead>
      <Tbl
        cols={['Provider', 'Protocol', 'Status']}
        rows={[
          ['Google Workspace', 'OpenID Connect', <><Dot tone="ok" /> Connected, 48 users</>],
          ['Microsoft Entra ID', 'SAML 2.0', <><Dot /> Not set up</>],
          ['Directory sync', 'SCIM 2.0', <><Dot tone="ok" /> On · last sync 08:00</>],
        ]}
      />
      <p className="f-k">Authenticator apps stay on for owners, and for anyone opening payroll figures.</p>
    </Fig>
  );
}

/* --------------------------------------------------------- what goes where */
/** Each product's hero figure: the one moment that explains it. */
export const HERO_FIGS = { books: InvoiceFig, people: EmployeeFig, attendance: TodayFig, payroll: PayRunFig, workspace: UsersFig };

/**
 * The capability figures on each product page, paired with the feature in
 * content.js they show (by its name). Features without a figure are listed
 * below them in words.
 */
export const CAPABILITY_FIGS = {
  books: [
    ['Sales', SalesListFig],
    ['GST', GstrFig],
    ['Inventory', StockFig],
    ['Banking', BankFig],
    ['Reports', PnlFig],
  ],
  people: [
    ['Time and leave', LeaveFig],
    ['Documents', DocumentsFig],
    ['Onboarding and exits', ExitFig],
    ['Org chart', OrgFig],
  ],
  attendance: [
    ['Readers', ReadersFig],
    ['Phone punch', PhonePunchFig],
    ['Shifts and rules', ShiftsFig],
    ['Month close', MonthCloseFig],
  ],
  payroll: [
    ['Salary structures', StructureFig],
    ['Statutory', StatutoryFig],
    ['Payslips', PayslipFig],
    ['Accounting', JournalFig],
  ],
  workspace: [
    ['Companies and branches', CompaniesFig],
    ['Outside access', OutsideAccessFig],
    ['Audit trail', AuditFig],
    ['Single sign-on', SsoFig],
  ],
};
