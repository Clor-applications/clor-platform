import React, { useEffect, useState } from 'react';
import { Quotes as QuoteMark } from '@phosphor-icons/react';
import { QUOTES } from '../../../packages/shell/authScenes.js';

/*
 * The lines the sign-in pages show, here as a band (owner, 13 Nov 2026): one at a
 * time, its subject above it, a bar that fills while it is up. It waits while the
 * pointer is on it, and stands still for anyone who asks for less motion. No
 * counter and no arrows (owner, 13 Nov 2026): the lines turn on their own. The list is the app's own (packages/shell/authScenes.js), so the site
 * and the sign-in pages never say different things.
 */
const MS = 8000;

export default function QuoteBand() {
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = setTimeout(() => setI((n) => (n + 1) % QUOTES.length), MS);
    return () => clearTimeout(t);
  }, [i, held]);
  const q = QUOTES[i];
  return (
    <section className="fx-quotes" aria-label="Words we work by">
      <figure
        className={`wrap fx-quotes-in${held ? ' is-held' : ''}`}
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
      >
        <span className="fx-quotes-mark" aria-hidden="true">
          <QuoteMark size={28} weight="fill" />
        </span>
        <div key={i} className="fx-quotes-line">
          <p className="fx-eyebrow">{q.about}</p>
          <blockquote>“{q.text}”</blockquote>
          <figcaption>{q.by}</figcaption>
        </div>
        <span className="fx-quotes-bar" aria-hidden="true">
          <span key={i} style={{ animationDuration: `${MS}ms` }} />
        </span>
      </figure>
    </section>
  );
}
