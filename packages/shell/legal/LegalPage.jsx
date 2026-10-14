import React, { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import ClorMark from '../ClorMark';
import { DOCUMENTS } from './documents';
import { legalHref } from './useLegalRoute';
import { missingDetails, operator } from '@platform/operator';
import LegalLinks from './LegalLinks';

/**
 * One legal document, readable signed in or out.
 *
 * Says plainly when the operator's details have not been filled in, rather
 * than presenting a draft as though it were in force.
 */
export default function LegalPage({ doc }) {
  const d = DOCUMENTS[doc];
  const heading = useRef(null);
  const missing = missingDetails();

  useEffect(() => {
    document.title = `${d.title} · Clor`;
    heading.current?.focus();
    window.scrollTo(0, 0);
    return () => {
      document.title = 'Clor';
    };
  }, [d.title]);

  const back = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.hash = '';
  };

  return (
    <div className="legal-page min-h-dvh" style={{ backgroundColor: 'rgb(var(--app-bg))' }}>
      <header className="legal-header">
        <div className="legal-wrap flex items-center gap-3">
          <a href="#" className="flex items-center gap-2" onClick={(e) => { e.preventDefault(); window.location.hash = ''; }}>
            <ClorMark size={22} />
            <span className="ui-display text-base">Clor</span>
          </a>
          <div className="flex-1" />
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={back}>
            <ArrowLeft size={14} aria-hidden="true" />
            Back
          </button>
        </div>
      </header>

      <main className="legal-wrap legal-main">
        <nav aria-label="Legal documents" className="legal-tabs">
          {Object.entries(DOCUMENTS).map(([key, x]) => (
            <a key={key} href={legalHref(key)} aria-current={key === doc ? 'page' : undefined}>
              {x.title}
            </a>
          ))}
        </nav>

        <article className="ui-surface legal-article">
          <h1 ref={heading} tabIndex={-1} className="ui-display text-2xl">{d.title}</h1>
          <p className="ui-muted mt-1">{d.summary}</p>
          <p className="ui-caption mt-2">
            Effective: {operator.effectiveDate || <span className="legal-placeholder">[effective date — to be provided]</span>}
          </p>

          {missing.length ? (
            <div role="note" className="legal-draft">
              <strong>Draft.</strong> The operator has not yet filled in: {missing.join(', ')}. Until they do, this
              document is incomplete and should not be relied on.
            </div>
          ) : null}

          <d.Body />
        </article>

        <footer className="legal-footer">
          <LegalLinks />
        </footer>
      </main>
    </div>
  );
}
