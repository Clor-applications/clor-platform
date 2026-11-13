import React from 'react';
import { Link } from '../router.jsx';
import { productBySlug } from '../site.js';
import { Mark } from './Brand.jsx';

/**
 * Premium product ribbon: each name and accent comes from the existing product catalogue.
 * No fabricated customer counts or social-proof claims.
 */
export function ProductRibbon() {
  return (
    <div className="premium-rail" aria-label="CLOR business applications">
      <div className="wrap premium-rail-inner">
        <span className="premium-rail-label">One connected workspace</span>
        <div className="premium-rail-products">
          {['books', 'people', 'payroll', 'attendance'].map((slug) => {
            const p = productBySlug(slug);
            return (
              <Link key={slug} className="premium-rail-item" href={`/products/${slug}`}>
                <Mark product={p} size={25} />
                <span>CLOR {p.name}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Cinematic-feeling sequence with real HTML instead of a looping video.
 * Fast to paint, selectable, screen-reader friendly, and usable without JS.
 * Deliberately not described as a literal API flow: CLOR's subscribed apps
 * share records, and exact flows depend on configuration.
 */
export function ConnectedFlow() {
  const items = [
    ['attendance', 'Capture worked time', 'Reader punches, mobile check-ins and shifts.'],
    ['people', 'Keep employee records', 'Employee details, leave requests and approvals.'],
    ['payroll', 'Run salaries', 'Paydays, statutory deductions and payslips.'],
    ['books', 'Post to accounts', 'Salary journals alongside the business books.'],
  ];
  return (
    <section className="premium-flow" aria-labelledby="premium-flow-title">
      <div className="wrap premium-flow-content">
        <span className="premium-eyebrow" style={{ color: '#ffae86' }}>A connected way to work</span>
        <h2 id="premium-flow-title">From the first punch to the final journal.</h2>
        <p style={{ marginTop: 17 }}>
          Each application stands on its own. Together, CLOR applications can share the information
          your team needs — without asking them to repeat the same work.
        </p>
        <div className="premium-flow-grid">
          {items.map(([slug, title, detail]) => {
            const p = productBySlug(slug);
            return (
              <div className="premium-flow-node" key={slug}>
                <Mark product={p} size={33} />
                <strong>{title}</strong>
                <p>{detail}</p>
              </div>
            );
          })}
        </div>
        <p className="premium-flow-note">
          Integration steps depend on the apps you subscribe to and the configuration used.
        </p>
      </div>
    </section>
  );
}
