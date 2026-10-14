import React from 'react';
import { DOCUMENTS } from './documents';
import { legalHref } from './useLegalRoute';
import { operator } from '@platform/operator';

/**
 * The policy links, for a footer. Only documents that apply to Clor exist —
 * there is no refund policy because Clor takes no payments.
 */
export default function LegalLinks({ className = '' }) {
  return (
    <nav aria-label="Legal" className={`legal-links ${className}`}>
      <ul>
        {Object.entries(DOCUMENTS).map(([key, d]) => (
          <li key={key}>
            <a href={legalHref(key)}>{d.title}</a>
          </li>
        ))}
        {operator.contactEmail ? (
          <li>
            <a href={`mailto:${operator.contactEmail}`}>Contact</a>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
