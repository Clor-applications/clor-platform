import React from 'react';
import { productBySlug } from '../site.js';
import { Mark } from './Brand.jsx';

/*
 * Miniature Clor screens, drawn in code with sample data (a fictional
 * "Anand Traders"). They follow the layout of the real screens; real
 * screenshots replace them once captured (CONTENT_CHECKLIST.md).
 */

function Frame({ slug, title, children, className = '' }) {
  const p = productBySlug(slug);
  return (
    <div className={`win ${className}`} data-product={slug}>
      <div className="win-bar">
        <Mark product={p} size={20} />
        <span className="win-app">{p.name}</span>
        <span className="win-title">{title}</span>
      </div>
      <div className="win-body">{children}</div>
    </div>
  );
}

const rupees = (n) => `₹${n.toLocaleString('en-IN')}`;

export function BooksWindow(props) {
  const lines = [
    ['Steel brackets, 40\u00a0mm', 120, 85],
    ['Hinges, heavy duty', 60, 140],
    ['Fitting labour', 1, 2400],
  ];
  const sub = lines.reduce((s, [, q, r]) => s + q * r, 0);
  const gst = Math.round(sub * 0.18);
  return (
    <Frame slug="books" title="Tax invoice INV-2026-0412" {...props}>
      <div className="w-row w-between">
        <div>
          <p className="w-k">Bill to</p>
          <p className="w-v">Mehta Interiors, Pune</p>
        </div>
        <span className="w-pill w-pill--ok">e-Invoice generated</span>
      </div>
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
      <div className="w-totals">
        <span>CGST 9% + SGST 9%</span>
        <span className="num">{rupees(gst)}</span>
        <strong>Total</strong>
        <strong className="num">{rupees(sub + gst)}</strong>
      </div>
    </Frame>
  );
}

export function PeopleWindow(props) {
  return (
    <Frame slug="people" title="Kavya Iyer" {...props}>
      <div className="w-row">
        <span className="w-avatar" aria-hidden="true">KI</span>
        <div>
          <p className="w-v">Kavya Iyer</p>
          <p className="w-k">Accounts executive, Pune office</p>
        </div>
      </div>
      <dl className="w-facts">
        <dt>Employee ID</dt>
        <dd>E042</dd>
        <dt>Joined</dt>
        <dd>3 June 2024</dd>
        <dt>Manager</dt>
        <dd>Rohit Anand</dd>
      </dl>
      <div className="w-checks">
        <span className="w-check is-done">Offer letter</span>
        <span className="w-check is-done">PAN and Aadhaar</span>
        <span className="w-check">Laptop issued</span>
      </div>
    </Frame>
  );
}

export function AttendanceWindow(props) {
  /* A month strip: P present, L leave, O weekly off, H half day. */
  const days = 'PPPPPOOPPPLPPOOPPHPPPOOPPPPPOOP'.split('');
  return (
    <Frame slug="attendance" title="October 2026" {...props}>
      <div className="w-row w-between">
        <p className="w-v">Kavya Iyer</p>
        <span className="w-pill">Ready to close</span>
      </div>
      <div className="w-month" aria-hidden="true">
        {days.map((d, i) => (
          <span key={i} className={`w-day w-day--${d}`} />
        ))}
      </div>
      <dl className="w-facts w-facts--3">
        <dt>Paid days</dt>
        <dd className="num">26.5</dd>
        <dt>Leave</dt>
        <dd className="num">1</dd>
        <dt>Overtime</dt>
        <dd className="num">3&nbsp;h</dd>
      </dl>
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
  const net = rows.reduce((s, [, v]) => s + v, 0);
  return (
    <Frame slug="payroll" title="Pay run, October 2026" {...props}>
      <div className="w-row w-between">
        <p className="w-v">48 employees</p>
        <span className="w-pill w-pill--ok">Locked</span>
      </div>
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
      <div className="w-totals">
        <strong>Net pay, Kavya</strong>
        <strong className="num">{rupees(net)}</strong>
      </div>
    </Frame>
  );
}

export const WINDOWS = { books: BooksWindow, people: PeopleWindow, attendance: AttendanceWindow, payroll: PayrollWindow };
