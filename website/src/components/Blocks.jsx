import React from 'react';
import { Link } from '../router.jsx';
import { SITE } from '../site.js';

/** A section's title and its line under it. */
export function SectionHead({ title, intro, as: H = 'h2', className = '' }) {
  return (
    <div className={`sec-head ${className}`.trim()}>
      <H className="h-1">{title}</H>
      {intro ? <p className="lede">{intro}</p> : null}
    </div>
  );
}

/** Questions with their answers shown: nothing to open, nothing hidden from a reader or a crawler. */
export function Faq({ items, title = 'Questions people ask' }) {
  return (
    <div className="faq">
      <h2 className="h-2">{title}</h2>
      <dl className="faq-list">
        {items.map(([q, a]) => (
          <div key={q} className="faq-item">
            <dt className="h-3">{q}</dt>
            <dd className="body">{a}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The page's last word: one demo request, and a way to just write to us. */
export function Closing({ title = 'See CLOR with your own company’s figures.', text = 'Tell us what you use today and we will show you the same work in CLOR.', demoHref = SITE.demoUrl, children }) {
  return (
    <section className="section closing">
      <div className="wrap closing-inner">
        <h2 className="h-1">{title}</h2>
        <p className="lede">{text}</p>
        <div className="actions">
          <Link className="btn btn--primary" href={demoHref}>
            Request a demo
          </Link>
          <a className="btn btn--trial" href={SITE.startUrl}>
            Start free trial
          </a>
          <Link className="btn btn--text" href="/contact">
            Write to us
          </Link>
        </div>
        {children ? <p className="small closing-note">{children}</p> : null}
      </div>
    </section>
  );
}

/** A sequence of work, written as a plain list: each step's name, then what happens. */
export function Steps({ steps }) {
  return (
    <dl className="steps">
      {steps.map(([t, d]) => (
        <div key={t}>
          <dt className="h-3">{t}</dt>
          <dd className="body">{d}</dd>
        </div>
      ))}
    </dl>
  );
}
