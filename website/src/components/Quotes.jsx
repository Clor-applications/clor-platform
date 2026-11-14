import React, { useEffect, useState } from 'react';
import { Pause, Play, Quotes as QuoteMark } from '@phosphor-icons/react';
import { QUOTES } from '../../../packages/shell/authScenes.js';

/*
 * The lines the sign-in pages show, here as a band (owner, 13 Nov 2026): one at a
 * time, its subject above it, a bar that fills while it is up. It waits while the
 * pointer is on it, and stands still for anyone who asks for less motion. No
 * counter and no arrows (owner, 13 Nov 2026): the lines turn on their own. One
 * small pause button beside the bar, because moving content that runs on by
 * itself must be stoppable without a mouse (WCAG 2.2.2). The list is the app's own (packages/shell/authScenes.js), so the site
 * and the sign-in pages never say different things.
 */
const MS = 8000;

export default function QuoteBand() {
  const [i, setI] = useState(0);
  const [hovered, setHeld] = useState(false);
  const [stopped, setStopped] = useState(false);
  const held = hovered || stopped;
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
        <div className="fx-quotes-ctl">
          <span className="fx-quotes-bar" aria-hidden="true">
            <span key={i} style={{ animationDuration: `${MS}ms` }} />
          </span>
          <button type="button" className="fx-quotes-pause" aria-label={stopped ? 'Play the quotes' : 'Pause the quotes'} onClick={() => setStopped(!stopped)}>
            {stopped ? <Play size={14} weight="fill" aria-hidden="true" /> : <Pause size={14} weight="fill" aria-hidden="true" />}
          </button>
        </div>
      </figure>
    </section>
  );
}
