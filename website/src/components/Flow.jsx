import React from 'react';
import { Link } from '../router.jsx';
import { CONNECTIONS, productBySlug } from '../site.js';
import { Mark } from './Brand.jsx';

/*
 * How the products fit together, as a line diagram: Attendance, Payroll and
 * Books in a row with the hand-off written on the line between them, and
 * People underneath as the record all three read, joined by hairlines. The
 * lines are an SVG stretched over the grid (straight lines only, so stretching
 * does not bend them); on a phone the three stack and People sits above them.
 */
const ROW = ['attendance', 'payroll', 'books'];
const text = (from, to) => CONNECTIONS.find((c) => c.from === from && c.to === to)?.text;

function Node({ slug, big }) {
  const p = productBySlug(slug);
  return (
    <Link href={`/products/${slug}`} className={`flow-node${big ? ' flow-node--big' : ''}`}>
      <Mark product={p} size={big ? 48 : 40} />
      <span className="flow-name">CLOR {p.name}</span>
      <span className="flow-who">{p.who}</span>
    </Link>
  );
}

export function Flow() {
  return (
    <div className="flow">
      <div className="flow-row">
        {ROW.map((slug, i) => (
          <React.Fragment key={slug}>
            <Node slug={slug} />
            {i < ROW.length - 1 ? (
              <div className="flow-edge" aria-hidden="true">
                <span className="flow-edge-line" />
                <span className="flow-edge-text">{i === 0 ? 'closes the month' : 'locks the run and posts the journal'}</span>
              </div>
            ) : null}
          </React.Fragment>
        ))}
      </div>
      <svg className="flow-bracket" viewBox="0 0 1000 80" preserveAspectRatio="none" aria-hidden="true">
        <path d="M100 0 V40 H900 V0 M500 0 V80" fill="none" stroke="currentColor" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flow-base">
        <Node slug="people" big />
        <p className="flow-note">The one employee record. Attendance enrols from it, Payroll pays from it, and the employee app opens it for its owner.</p>
      </div>
      <ul className="sr-only">
        {CONNECTIONS.map((c) => (
          <li key={c.from + c.to}>{text(c.from, c.to)}</li>
        ))}
      </ul>
    </div>
  );
}
