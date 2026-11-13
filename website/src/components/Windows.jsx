import React from 'react';
import { ArrowsClockwise, Bell, ChartBar, CheckCircle, DeviceMobile, FileText, Fingerprint, Gear, House, QrCode, Receipt, Users } from '@phosphor-icons/react';
import { productBySlug } from '../site.js';
import { Mark } from './Brand.jsx';

/*
 * Miniature CLOR screens, drawn in code with sample data (a fictional
 * "Anand Traders"). Each is a scene, not a flat table (owner, 13 Nov 2026:
 * "very flat, nothing in this"): an app window with its coloured rail and
 * figures as tiles, and one or two notes floating over its edge that say
 * what just happened. They follow the layout of the real screens; real
 * screenshots replace them once captured (CONTENT_CHECKLIST.md).
 * `bare` leaves the floating notes out, for a screen used as a backdrop.
 */

const RAIL = [House, FileText, Users, ChartBar, Gear];

function Frame({ slug, title, action, children, pops, bare, at = 1 }) {
  const p = productBySlug(slug);
  return (
    <div className="scene" data-p={slug}>
      <div className="win" data-product={slug}>
        <div className="win-rail" aria-hidden="true">
          <Mark product={p} size={22} />
          {RAIL.map((Icon, i) => (
            <span key={i} className={i === at ? 'is-on' : undefined}>
              <Icon size="1.25em" weight={i === at ? 'fill' : 'regular'} />
            </span>
          ))}
        </div>
        <div className="win-main">
          <div className="win-bar">
            <span className="win-app">{p.name}</span>
            <span className="win-title">{title}</span>
            {action ? <span className="win-action">{action}</span> : null}
          </div>
          <div className="win-body">{children}</div>
        </div>
      </div>
      {bare ? null : pops}
    </div>
  );
}

/** A note floating over the screen's edge: what just happened, with its mark. */
function Pop({ icon: Icon, tone = 'ok', where, title, text }) {
  return (
    <div className={`pop pop--${tone} pop--${where}`}>
      <span className="pop-icon">
        <Icon size="1.3em" weight="fill" />
      </span>
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
    </div>
  );
}

/** Figures across the top of a screen; one may be the lead, in the product's colour. */
function Tiles({ items }) {
  return (
    <div className="w-tiles">
      {items.map(([k, v, lead]) => (
        <div key={k} className={`w-tile${lead ? ' w-tile--lead' : ''}`}>
          <span>{k}</span>
          <strong className="num">{v}</strong>
        </div>
      ))}
    </div>
  );
}

const rupees = (n) => `₹${n.toLocaleString('en-IN')}`;

export function BooksWindow(props) {
  const lines = [
    ['Steel brackets, 40 mm', 120, 85],
    ['Hinges, heavy duty', 60, 140],
    ['Fitting labour', 1, 2400],
  ];
  const sub = lines.reduce((s, [, q, r]) => s + q * r, 0);
  const gst = Math.round(sub * 0.18);
  return (
    <Frame
      slug="books"
      title="Tax invoice INV-2026-0412"
      action="Send invoice"
      pops={
        <>
          <Pop where="tr" icon={CheckCircle} title="e-Invoice generated" text="IRN and QR code on the invoice" />
          <Pop where="bl" tone="app" icon={QrCode} title={`Paid by UPI, ${rupees(sub + gst)}`} text="Receipt recorded against the invoice" />
        </>
      }
      {...props}
    >
      <div className="w-row w-between">
        <div className="w-row">
          <span className="w-avatar" aria-hidden="true">MI</span>
          <div>
            <p className="w-k">Bill to</p>
            <p className="w-v">Mehta Interiors, Pune</p>
          </div>
        </div>
        <span className="w-pill w-pill--ok">Sent</span>
      </div>
      <Tiles items={[['Taxable value', rupees(sub)], ['CGST 9% + SGST 9%', rupees(gst)], ['Total', rupees(sub + gst), true]]} />
      <table className="w-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Qty</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(([n, q, r]) => (
            <tr key={n}>
              <td>{n}</td>
              <td className="num">{q}</td>
              <td className="num">{rupees(q * r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Frame>
  );
}

export function PeopleWindow(props) {
  const docs = [
    ['Offer letter', true],
    ['PAN and Aadhaar', true],
    ['Laptop issued', false],
  ];
  return (
    <Frame
      slug="people"
      at={2}
      title="Employee record"
      action="Edit"
      pops={
        <>
          <Pop where="tr" tone="warn" icon={Bell} title="Document expiring" text="Reminder sent before the date" />
          <Pop where="bl" tone="app" icon={DeviceMobile} title="Leave request, 2 days" text="From the employee app, with the manager" />
        </>
      }
      {...props}
    >
      <div className="w-profile">
        <span className="w-avatar w-avatar--lg" aria-hidden="true">KI</span>
        <div>
          <p className="w-v">Kavya Iyer</p>
          <p className="w-k">Accounts executive, Pune office</p>
        </div>
        <span className="w-pill w-pill--ok">Active</span>
      </div>
      <Tiles items={[['Employee ID', 'E042'], ['Joined', '3 June 2024'], ['Manager', 'Rohit Anand']]} />
      <div className="w-progress">
        <div className="w-row w-between">
          <span className="w-k">Joining checklist</span>
          <span className="w-k num">2 of 3</span>
        </div>
        <span className="w-bar" aria-hidden="true">
          <span style={{ width: '66%' }} />
        </span>
      </div>
      <ul className="w-list">
        {docs.map(([name, done]) => (
          <li key={name} className={done ? 'is-done' : undefined}>
            <CheckCircle size="1.25em" weight={done ? 'fill' : 'regular'} aria-hidden="true" />
            {name}
            <span>{done ? 'Done' : 'Waiting on IT'}</span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

export function AttendanceWindow(props) {
  /* A month strip: P present, L leave, O weekly off, H half day. */
  const days = 'PPPPPOOPPPLPPOOPPHPPPOOPPPPPOOP'.split('');
  return (
    <Frame
      slug="attendance"
      at={3}
      title="October 2026"
      action="Close month"
      pops={
        <>
          <Pop where="tr" tone="app" icon={Fingerprint} title="09:14, punched in" text="Main gate reader, as it happened" />
          <Pop where="bl" icon={CheckCircle} title="Ready to close" text="Paid days and overtime go to Payroll" />
        </>
      }
      {...props}
    >
      <div className="w-row w-between">
        <div className="w-row">
          <span className="w-avatar" aria-hidden="true">KI</span>
          <div>
            <p className="w-v">Kavya Iyer</p>
            <p className="w-k">General shift, 9:30 to 6:30</p>
          </div>
        </div>
        <span className="w-pill w-pill--ok">Ready to close</span>
      </div>
      <Tiles items={[['Paid days', '26.5', true], ['Leave', '1'], ['Overtime', '3 h']]} />
      <div className="w-month" aria-hidden="true">
        {days.map((d, i) => (
          <span key={i} className={`w-day w-day--${d}`} />
        ))}
      </div>
      <p className="w-legend" aria-hidden="true">
        <span className="w-day w-day--P" /> Present <span className="w-day w-day--L" /> Leave <span className="w-day w-day--H" /> Half day <span className="w-day w-day--O" /> Weekly off
      </p>
    </Frame>
  );
}

export function PayrollWindow(props) {
  const rows = [
    ['Basic', 21000],
    ['HRA', 8400],
    ['PF (employee)', -2520],
    ['Professional tax', -200],
  ];
  const earned = rows.filter(([, v]) => v > 0).reduce((s, [, v]) => s + v, 0);
  const net = rows.reduce((s, [, v]) => s + v, 0);
  return (
    <Frame
      slug="payroll"
      title="Pay run, October 2026"
      action="Pay salaries"
      pops={
        <>
          <Pop where="tr" tone="app" icon={DeviceMobile} title="Payslips sent" text="To 48 employees’ phones" />
          <Pop where="bl" icon={ArrowsClockwise} title="Journal posted to Books" text="When the run was locked" />
        </>
      }
      {...props}
    >
      <div className="w-row w-between">
        <div className="w-row">
          <span className="w-avatar" aria-hidden="true">KI</span>
          <div>
            <p className="w-v">Kavya Iyer</p>
            <p className="w-k">1 of 48 employees in this run</p>
          </div>
        </div>
        <span className="w-pill w-pill--ok">Locked</span>
      </div>
      <Tiles items={[['Earnings', rupees(earned)], ['Deductions', `− ${rupees(earned - net)}`], ['Net pay', rupees(net), true]]} />
      <span className="w-bar w-bar--split" aria-hidden="true">
        <span style={{ width: `${Math.round((net / earned) * 100)}%` }} />
      </span>
      <table className="w-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td className="num">{v < 0 ? `− ${rupees(-v)}` : rupees(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Frame>
  );
}

/** The month's GSTR-1 as Books builds it from the invoices raised (sample figures). */
export function GstrWindow(props) {
  const rows = [
    ['B2B invoices', 142, 1840500],
    ['B2C invoices', 316, 412300],
    ['Credit notes', 6, -38200],
  ];
  const taxable = rows.reduce((s, [, , v]) => s + v, 0);
  const most = Math.max(...rows.map(([, , v]) => Math.abs(v)));
  return (
    <Frame
      slug="books"
      at={3}
      title="GSTR-1, October 2026"
      action="File return"
      pops={
        <>
          <Pop where="tr" icon={CheckCircle} title="Ready to file" text="Built from the invoices you raised" />
          <Pop where="bl" tone="app" icon={Receipt} title={`${rows.reduce((s, [, n]) => s + n, 0)} documents`} text="Nothing typed in again" />
        </>
      }
      {...props}
    >
      <div className="w-row w-between">
        <div>
          <p className="w-v">Anand Traders</p>
          <p className="w-k">GSTIN 27AAKFA4821L1Z3</p>
        </div>
        <span className="w-pill w-pill--ok">Ready to file</span>
      </div>
      <Tiles items={[['Taxable value', rupees(taxable)], ['Tax, CGST + SGST + IGST', rupees(Math.round(taxable * 0.18)), true]]} />
      <ul className="w-bars">
        {rows.map(([k, n, v]) => (
          <li key={k}>
            <span>
              {k} <small className="num">{n}</small>
            </span>
            <span className="w-bar" aria-hidden="true">
              <span style={{ width: `${Math.max(4, Math.round((Math.abs(v) / most) * 100))}%` }} />
            </span>
            <strong className="num">{v < 0 ? `− ${rupees(-v)}` : rupees(v)}</strong>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

export const WINDOWS = { books: BooksWindow, people: PeopleWindow, attendance: AttendanceWindow, payroll: PayrollWindow };
