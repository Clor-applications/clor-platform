import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Link } from '../router.jsx';
import { PRODUCTS, SITE } from '../site.js';
import { Mark, Status } from './Brand.jsx';

/** A section's title. `center` sets it over the section with the short accent rule, for full-width sections. */
export function SectionHead({ title, intro, as: H = 'h2', className = '', center = false }) {
  return (
    <div className={`sec-head${center ? ' sec-head--center' : ''} ${className}`}>
      <H className="h-1">{title}</H>
      {center ? <span className="rule" aria-hidden="true" /> : null}
      {intro ? <p className="lede">{intro}</p> : null}
    </div>
  );
}

/** Questions as disclosure rows: native <details>, so they work without script and with a keyboard. */
export function Faq({ items, title = 'Questions people ask' }) {
  return (
    <div className="faq">
      <h2 className="h-2">{title}</h2>
      <div className="faq-list">
        {items.map(([q, a]) => (
          <details key={q} className="faq-item">
            <summary>
              <span>{q}</span>
              <ChevronDown size={18} strokeWidth={1.75} aria-hidden="true" />
            </summary>
            <p className="body">{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}

export function Closing({ title = 'Start with one product. Add the rest when you need them.', text = 'Create your workspace, choose the apps you need and invite your team.', children }) {
  return (
    <section className="section closing">
      <div className="wrap closing-inner">
        <h2 className="h-1">{title}</h2>
        <p className="lede">{text}</p>
        <div className="actions">
          <a className="btn btn--primary" href={SITE.signUpUrl}>
            Get started
          </a>
          <Link className="btn btn--quiet" href="/contact">
            Talk to us
          </Link>
        </div>
        {children ? <p className="small closing-note">{children}</p> : null}
      </div>
    </section>
  );
}

/** The product list: a ruled index, not a card grid — each row a product, its job, its state. */
export function ProductIndex({ products = PRODUCTS }) {
  return (
    <ul className="pindex">
      {products.map((p) => (
        <li key={p.slug}>
          <Link href={`/products/${p.slug}`} className="pindex-row" style={{ '--accent-p': p.accent }}>
            <Mark product={p} size={40} />
            <span className="pindex-name">Clor {p.name}</span>
            <span className="pindex-line">{p.line}</span>
            <span className="pindex-meta">
              <span className="small">{p.category}</span>
              <Status product={p} />
            </span>
            <ChevronRight className="pindex-go" size={18} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** A screen that is revealed once, from the bottom edge up, when it scrolls into view. */
export function Reveal({ children, className = '' }) {
  const ref = useRef(null);
  const [state, setState] = useState('');
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = ref.current;
    const box = el.getBoundingClientRect();
    if (box.top < window.innerHeight * 0.85) return; /* already on screen: leave it be */
    setState('is-armed');
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setState('is-armed is-shown');
          io.disconnect();
        }
      },
      { threshold: 0.25 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${state} ${className}`}>
      {children}
    </div>
  );
}

/** Tabs that are real buttons with the ARIA tab pattern and arrow keys. */
export function Tabs({ tabs, label }) {
  const [i, setI] = useState(0);
  const onKey = (e) => {
    if (e.key === 'ArrowRight') setI((i + 1) % tabs.length);
    if (e.key === 'ArrowLeft') setI((i - 1 + tabs.length) % tabs.length);
  };
  return (
    <div className="tabs">
      <div role="tablist" aria-label={label} className="tabs-list" onKeyDown={onKey}>
        {tabs.map((t, n) => (
          <button key={t.key} role="tab" id={`tab-${t.key}`} aria-controls={`panel-${t.key}`} aria-selected={i === n} tabIndex={i === n ? 0 : -1} className="tab" onClick={() => setI(n)}>
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, n) => (
        <div key={t.key} role="tabpanel" id={`panel-${t.key}`} aria-labelledby={`tab-${t.key}`} hidden={i !== n} className="tab-panel">
          {t.body}
        </div>
      ))}
    </div>
  );
}

/**
 * Numbered steps with a progress indicator: as the reader moves down, the
 * steps passed are filled and the one in view is marked. Without script the
 * list reads plainly.
 */
export function Steps({ steps }) {
  const ref = useRef(null);
  const [at, setAt] = useState(-1);
  useEffect(() => {
    const items = [...ref.current.querySelectorAll('li')];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setAt((cur) => Math.max(cur, items.indexOf(e.target)));
      },
      { rootMargin: '0px 0px -45% 0px', threshold: 0.6 }
    );
    items.forEach((li) => io.observe(li));
    return () => io.disconnect();
  }, []);
  return (
    <ol className={`steps${at >= 0 ? ' is-tracking' : ''}`} ref={ref}>
      {steps.map(([t, d], n) => (
        <li key={t} className={n < at ? 'is-done' : n === at ? 'is-current' : ''}>
          <h3 className="h-3">{t}</h3>
          <p className="body">{d}</p>
        </li>
      ))}
    </ol>
  );
}
