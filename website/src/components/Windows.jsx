import React from 'react';
import { productBySlug } from '../site.js';
import { Mark } from './Brand.jsx';

/*
 * CLOR screens drawn in HTML and CSS with sample data (a fictional "Anand
 * Traders", Pune). Each follows the real app's layout: a rail of its
 * sections on the left, the record on the right, the app's own accent kept
 * muted on the current section. They sit in a fixed 16:11 frame, so the page
 * never shifts, and scale with the column they are in (container units).
 * Real screenshots replace them once captured (CONTENT_CHECKLIST.md).
 */

const rupees = (n) => `₹${n.toLocaleString('en-IN')}`;

function Frame({ slug, title, rail, current, right, children, caption = true }) {
  const p = productBySlug(slug);
  return (
    <figure className="shot" data-product={slug} style={{ '--acc': p.accent }}>
      <div className="win" role="img" aria-label={`${p.name}: ${title}, drawn with sample data`}>
        <div className="win-bar">
          <Mark product={p} size={20} />
          <span className="win-app">{p.name}</span>
          <span className="win-crumb">{title}</span>
          <span className="win-right">{right || 'Anand Traders'}</span>
        </div>
        <div className="win-main">
          <ul className="win-rail" aria-hidden="true">
            {rail.map((r) => (
              <li key={r} className={r === current ? 'is-current' : ''}>
                {r}
              </li>
            ))}
          </ul>
          <div className="win-body">{children}</div>
        </div>
      </div>
      {caption ? <figcaption className="caption">CLOR {p.name}, drawn with sample data.</figcaption> : null}
    </figure>
  );
}

/* ------------------------------------------------------------------ Books */
export function BooksWindow(props) {
  const lines = [
    ['Steel brackets, 40 mm', '7326', 120, 85],
    ['Hinges, heavy duty', '8302', 60, 140],
    ['Fitting labour', '9987', 1, 2400],
  ];
  const sub = lines.reduce((s, [, , q, r]) => s + q * r, 0);
  const half = Math.round(sub * 0.09);
  return (
    <Frame slug="books" title="Sales / Tax invoice INV-2026-0412" rail={['Home', 'Sales', 'Purchases', 'Inventory', 'Banking', 'GST', 'Reports']} current="Sales" {...props}>
      <div className="w-head">
        <div>
          <p className="w-title">Tax invoice INV-2026-0412</p>
          <p className="w-k">12 October 2026 · Due 11 November 2026</p>
        </div>
        <div className="w-pills">
          <span className="w-pill w-pill--ok">e-Invoice · IRN 7a3f…c91e</span>
          <span className="w-pill">Unpaid</span>
        </div>
      </div>
      <div className="w-cols">
        <div>
          <p className="w-k">Bill to</p>
          <p className="w-v">Mehta Interiors</p>
          <p className="w-k">Kothrud, Pune 411038</p>
          <p className="w-k">GSTIN 27AABCM4512F1Z7</p>
        </div>
        <div>
          <p className="w-k">Place of supply</p>
          <p className="w-v">Maharashtra (27)</p>
          <p className="w-k">Payment</p>
          <p className="w-v">Bank transfer or UPI link</p>
        </div>
      </div>
      <table className="w-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>HSN/SAC</th>
            <th className="num">Qty</th>
            <th className="num">Rate</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(([n, h, q, r]) => (
            <tr key={n}>
              <td>{n}</td>
              <td className="w-k">{h}</td>
              <td className="num">{q}</td>
              <td className="num">{rupees(r)}</td>
              <td className="num">{rupees(q * r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="w-totals">
        <span>Taxable value</span>
        <span className="num">{rupees(sub)}</span>
        <span>CGST 9%</span>
        <span className="num">{rupees(half)}</span>
        <span>SGST 9%</span>
        <span className="num">{rupees(half)}</span>
        <strong>Total</strong>
        <strong className="num">{rupees(sub + 2 * half)}</strong>
      </div>
      <p className="w-k">Rupees twenty-four thousand seven hundred and eighty only. Posted to Sales and Output GST on save.</p>
    </Frame>
  );
}

/** The month's GSTR-1 as Books builds it from the invoices raised. */
export function GstrWindow(props) {
  const rows = [
    ['B2B invoices', 142, 1840500],
    ['B2C invoices', 316, 412300],
    ['Credit notes', 6, -38200],
    ['Exports and SEZ', 2, 96000],
  ];
  const taxable = rows.reduce((s, [, , v]) => s + v, 0);
  const tax = Math.round(taxable * 0.18);
  return (
    <Frame slug="books" title="GST / GSTR-1, October 2026" rail={['Home', 'Sales', 'Purchases', 'Inventory', 'Banking', 'GST', 'Reports']} current="GST" {...props}>
      <div className="w-head">
        <div>
          <p className="w-title">GSTR-1, October 2026</p>
          <p className="w-k">Anand Traders · GSTIN 27AAKFA4821L1Z3 · Pune branch</p>
        </div>
        <div className="w-pills">
          <span className="w-pill w-pill--ok">Ready to file</span>
          <span className="w-pill">Due 11 November</span>
        </div>
      </div>
      <div className="w-stats">
        <div>
          <strong className="num">466</strong>
          <span>Documents</span>
        </div>
        <div>
          <strong className="num">142</strong>
          <span>e-Invoices with IRN</span>
        </div>
        <div>
          <strong className="num">38</strong>
          <span>e-Way bills</span>
        </div>
        <div>
          <strong className="num">0</strong>
          <span>Missing GSTIN</span>
        </div>
      </div>
      <table className="w-table">
        <thead>
          <tr>
            <th>Section</th>
            <th className="num">Count</th>
            <th className="num">Taxable value</th>
            <th className="num">Tax</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, n, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td className="num">{n}</td>
              <td className="num">{v < 0 ? `− ${rupees(-v)}` : rupees(v)}</td>
              <td className="num">{v < 0 ? `− ${rupees(Math.round(-v * 0.18))}` : rupees(Math.round(v * 0.18))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="w-totals">
        <span>Taxable value</span>
        <span className="num">{rupees(taxable)}</span>
        <span>CGST + SGST + IGST</span>
        <span className="num">{rupees(tax)}</span>
        <strong>Total outward supplies</strong>
        <strong className="num">{rupees(taxable + tax)}</strong>
      </div>
      <p className="w-k">Built from the month’s invoices and credit notes as they were raised. GSTR-3B uses the same figures.</p>
    </Frame>
  );
}

/* ----------------------------------------------------------------- People */
export function PeopleWindow(props) {
  const checklist = [
    ['Offer letter signed', 'HR', true],
    ['PAN and Aadhaar collected', 'HR', true],
    ['Bank details verified', 'Finance', true],
    ['Enrolled on the gate reader', 'Admin', true],
    ['Laptop issued', 'IT', false],
    ['Added to health insurance', 'HR', false],
  ];
  return (
    <Frame slug="people" title="Employees / Kavya Iyer" rail={['Home', 'Employees', 'Time', 'Leave', 'Documents', 'Org chart', 'Letters']} current="Employees" {...props}>
      <div className="w-head">
        <div className="w-row">
          <span className="w-avatar" aria-hidden="true">
            KI
          </span>
          <div>
            <p className="w-title">Kavya Iyer</p>
            <p className="w-k">Accounts executive · Finance · Pune office · E042</p>
          </div>
        </div>
        <span className="w-pill w-pill--ok">Active</span>
      </div>
      <div className="w-tabs" aria-hidden="true">
        {['Profile', 'Job', 'Documents', 'Time', 'History'].map((t) => (
          <span key={t} className={t === 'Profile' ? 'is-current' : ''}>
            {t}
          </span>
        ))}
      </div>
      <dl className="w-facts w-facts--2">
        <dt>Joined</dt>
        <dd>3 June 2024</dd>
        <dt>Manager</dt>
        <dd>Rohit Anand</dd>
        <dt>Employment</dt>
        <dd>Full time, confirmed</dd>
        <dt>UAN</dt>
        <dd>1012 4456 7890</dd>
      </dl>
      <div className="w-cols">
        <div>
          <p className="w-sub">Joining checklist · 4 of 6 done</p>
          <ul className="w-list">
            {checklist.map(([t, who, done]) => (
              <li key={t} className={done ? 'is-done' : ''}>
                <span className="w-tick" aria-hidden="true" />
                <span>{t}</span>
                <span className="w-k">{who}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="w-sub">Documents expiring</p>
          <ul className="w-list">
            <li className="is-warn">
              <span className="w-tick" aria-hidden="true" />
              <span>Passport</span>
              <span className="w-k">14 Dec 2026</span>
            </li>
            <li className="is-warn">
              <span className="w-tick" aria-hidden="true" />
              <span>Driving licence</span>
              <span className="w-k">2 Feb 2027</span>
            </li>
            <li>
              <span className="w-tick" aria-hidden="true" />
              <span>Degree certificate</span>
              <span className="w-k">No expiry</span>
            </li>
          </ul>
        </div>
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------- Attendance */
export function AttendanceWindow(props) {
  const rows = [
    ['Kavya Iyer', 'General 9:30–18:30', '09:24', 'Main gate reader', 'Present', 'ok'],
    ['Arjun Nair', 'General 9:30–18:30', '09:52', 'Main gate reader', 'Late 22 min', 'warn'],
    ['Priya Menon', 'Field 10:00–19:00', '10:05', 'Phone · Baner site', 'Present', 'ok'],
    ['Suresh Babu', 'General 9:30–18:30', '—', '', 'Casual leave', 'off'],
    ['Meera Pillai', 'Second 14:00–22:00', '—', '', 'Not yet in', ''],
  ];
  return (
    <Frame slug="attendance" title="Today / Tuesday 10 November 2026" rail={['Today', 'Employees', 'Shifts', 'Leave', 'Requests', 'Month close', 'Readers']} current="Today" {...props}>
      <div className="w-stats">
        <div>
          <strong className="num">42</strong>
          <span>Present</span>
        </div>
        <div>
          <strong className="num">3</strong>
          <span>Late</span>
        </div>
        <div>
          <strong className="num">4</strong>
          <span>On leave</span>
        </div>
        <div>
          <strong className="num">2</strong>
          <span>Not yet in</span>
        </div>
      </div>
      <table className="w-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Shift</th>
            <th>In</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([n, s, t, from, st, tone]) => (
            <tr key={n}>
              <td className="w-v">{n}</td>
              <td className="w-k">{s}</td>
              <td>
                <span className="num">{t}</span>
                {from ? <span className="w-k w-from"> {from}</span> : null}
              </td>
              <td>
                <span className={`w-dot w-dot--${tone}`} aria-hidden="true" />
                {st}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="w-cols">
        <div>
          <p className="w-sub">Who is out today</p>
          <p className="w-k">Suresh Babu, casual leave · Deepa Rao, sick leave · Rahul Verma, weekly off · Nikhil Shah, on duty at client</p>
        </div>
        <div>
          <p className="w-sub">Waiting for a manager</p>
          <p className="w-k">1 missed punch (Arjun Nair, 9 Nov) · 2 leave requests for next week</p>
        </div>
      </div>
    </Frame>
  );
}

/* ---------------------------------------------------------------- Payroll */
export function PayrollWindow(props) {
  const earn = [
    ['Gross earnings', 1482400],
    ['Basic and dearness', 842000],
    ['HRA, conveyance and allowances', 640400],
  ];
  const ded = [
    ['PF, employee 12%', 112680],
    ['ESI, employee 0.75%', 6120],
    ['Professional tax', 9600],
    ['TDS', 84300],
  ];
  const net = earn[0][1] - ded.reduce((s, [, v]) => s + v, 0);
  return (
    <Frame slug="payroll" title="Pay runs / October 2026" rail={['Pay runs', 'Employees', 'Salary structures', 'Statutory', 'Reports', 'Settings']} current="Pay runs" {...props}>
      <div className="w-head">
        <div>
          <p className="w-title">Pay run, October 2026</p>
          <p className="w-k">48 employees · 26 working days · Pay day 1 November</p>
        </div>
        <span className="w-pill w-pill--ok">Locked · journal posted to Books</span>
      </div>
      <div className="w-cols">
        <table className="w-table">
          <tbody>
            {earn.map(([k, v], i) => (
              <tr key={k} className={i === 0 ? 'w-strong' : ''}>
                <td>{k}</td>
                <td className="num">{rupees(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="w-table">
          <tbody>
            {ded.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td className="num">− {rupees(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <table className="w-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th className="num">Gross</th>
            <th className="num">PF</th>
            <th className="num">TDS</th>
            <th className="num">Net pay</th>
            <th>Payslip</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['Kavya Iyer', 37000, 2520, 0, 34280],
            ['Arjun Nair', 62500, 1800, 3900, 56600],
            ['Priya Menon', 48000, 1800, 1250, 44750],
          ].map(([n, g, pf, tds, net]) => (
            <tr key={n}>
              <td className="w-v">{n}</td>
              <td className="num">{rupees(g)}</td>
              <td className="num">{rupees(pf)}</td>
              <td className="num">{tds ? rupees(tds) : '—'}</td>
              <td className="num">{rupees(net)}</td>
              <td className="w-k">In the app</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="w-totals w-totals--net">
        <strong>Net pay to 48 bank accounts</strong>
        <strong className="num">{rupees(net)}</strong>
        <span>Employer PF 12% and ESI 3.25%, paid separately</span>
        <span className="num">{rupees(112680 + 26520)}</span>
      </div>
      <div className="w-tags">
        <span>PF ECR file ready</span>
        <span>ESI return ready</span>
        <span>48 payslips in the employee app</span>
        <span>Form 16 at year end</span>
      </div>
    </Frame>
  );
}

/* -------------------------------------------------------------- Workspace */
export function WorkspaceWindow(props) {
  const users = [
    ['Rohit Anand', 'Owner', 'All products, both companies', ''],
    ['Kavya Iyer', 'Accountant', 'Books, Payroll · Anand Traders', ''],
    ['Sharma & Co, CA', 'Accountant', 'Books · Anand Traders', 'Until 31 Mar 2027'],
    ['Priya Menon', 'Manager', 'People, Attendance · her team', ''],
  ];
  return (
    <Frame slug="workspace" title="Access / Users and roles" rail={['Companies', 'Branches', 'Access', 'Invitations', 'Audit trail', 'Subscriptions']} current="Access" right="Rohit Anand" {...props}>
      <div className="w-head">
        <div>
          <p className="w-title">Users and roles</p>
          <p className="w-k">Anand Traders · Anand Exports LLP · 2 companies, 3 branches</p>
        </div>
        <span className="w-pill">4 users · 1 invitation open</span>
      </div>
      <table className="w-table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Role</th>
            <th>Sees</th>
          </tr>
        </thead>
        <tbody>
          {users.map(([n, r, sees, until]) => (
            <tr key={n}>
              <td className="w-v">{n}</td>
              <td>{r}</td>
              <td className="w-k">
                {sees}
                {until ? <span className="w-pill w-pill--sm"> {until}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="w-sub">Audit trail</p>
      <ul className="w-log">
        <li>
          <span className="w-k num">10 Nov, 09:14</span>
          <span>
            <b>Rohit Anand</b> changed Kavya Iyer’s role in Anand Traders from Staff to Accountant.
          </span>
        </li>
        <li>
          <span className="w-k num">1 Nov, 11:02</span>
          <span>
            <b>Kavya Iyer</b> locked the pay run for October 2026; its journal was posted to Books.
          </span>
        </li>
        <li>
          <span className="w-k num">28 Oct, 16:40</span>
          <span>
            <b>Rohit Anand</b> invited Sharma &amp; Co to Books as Accountant, until 31 March 2027.
          </span>
        </li>
      </ul>
    </Frame>
  );
}

export const WINDOWS = { books: BooksWindow, people: PeopleWindow, attendance: AttendanceWindow, payroll: PayrollWindow, workspace: WorkspaceWindow };
