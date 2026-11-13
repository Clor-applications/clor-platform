import React, { useEffect, useState } from 'react';
import { Check } from '@ui/components/ui/lineIcons';
import { ClorLogo } from '@ui/components/brand';
import LegalLinks from './legal/LegalLinks';
import { appFromHost } from './appHosts';
import { QUOTES, sceneFile, sceneRatio, sceneSrc, sceneTitle } from './authScenes';

/**
 * The frame both sign-in and sign-up sit in.
 *
 * One layout rather than two, because the two pages are the same room with a
 * different form in it — and a sign-up that looked like a different product
 * would make somebody wonder whether they had followed the right link.
 *
 * The brand side says plainly what CLOR does and shows a day in it. It
 * carries the platform claim, not the accounting one — somebody signing in may
 * be here for payroll alone. No slogan, accent word or decoration (owner,
 * 8 Nov 2026: drop what reads as machine-made).
 */

/* What a day in CLOR looks like: two things done, one waiting on you. */
const TODAY = [
  { text: 'GSTR-1 filed', done: true },
  { text: 'Salaries paid', done: true },
  { text: '2 leave requests', done: false },
];

/* The default brand side. A caller that is not the customer's door (the operator console) passes its own. */
function CustomerBrand() {
  return (
    <>
      <div className="ui-auth-copy">
        <h2 className="ui-auth-title">Accounts, GST, staff and salaries for growing companies in India.</h2>
      </div>

      <div className="ui-auth-today" aria-label="An example day">
        <p className="ui-auth-today-title">Today</p>
        <ul>
          {TODAY.map(({ text, done }) => (
            <li key={text} className={done ? undefined : 'is-waiting'}>
              {done ? <span className="ui-auth-today-done" aria-hidden="true"><Check size={12} strokeWidth={3} /></span> : <span className="ui-auth-today-ring" aria-hidden="true" />}
              <span>{text}</span>
              <span className="sr-only">{done ? ', done' : ', waiting on you'}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/**
 * Lines worth reading, turning over one after another on the picture: the subject,
 * the line, who said it. A thin bar fills as the line's time runs; it waits while
 * the pointer or the keyboard is on the card. Held still for anyone who asks for
 * less motion; the arrows let a reader go back or on.
 */
const QUOTE_MS = 8000;
function Quotes() {
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = setTimeout(() => setI((n) => (n + 1) % QUOTES.length), QUOTE_MS);
    return () => clearTimeout(t);
  }, [i, held]);
  const q = QUOTES[i];
  const go = (step) => setI((n) => (n + step + QUOTES.length) % QUOTES.length);
  return (
    <figure
      className={`ui-auth-facts${held ? ' is-held' : ''}`}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div key={i} className="ui-auth-fact" aria-live="off">
        <p className="ui-auth-fact-about">{q.about}</p>
        <blockquote>“{q.text}”</blockquote>
        <figcaption>{q.by}</figcaption>
      </div>
      <div className="ui-auth-fact-foot">
        <span className="ui-auth-fact-bar" aria-hidden="true">
          <span key={i} style={{ animationDuration: `${QUOTE_MS}ms` }} />
        </span>
        <span className="ui-auth-fact-count" aria-hidden="true">
          {i + 1} / {QUOTES.length}
        </span>
        <button type="button" aria-label="Previous quote" onClick={() => go(-1)}>
          ‹
        </button>
        <button type="button" aria-label="Next quote" onClick={() => go(1)}>
          ›
        </button>
      </div>
    </figure>
  );
}

/**
 * The picture side: the whole picture, never cropped (owner, 10 Nov 2026). The side is
 * cut to the picture's own shape where the screen allows; where it is narrower, the
 * picture is shown whole over a soft, blurred copy of itself. Quotes along the bottom.
 * On a phone it is a band above the form.
 */
function Scene({ file, band = false }) {
  const { src, srcSet } = sceneSrc(file);
  const words = sceneTitle(file);
  return (
    <div className={band ? 'ui-auth-scene-band lg:hidden' : 'ui-auth-scene'}>
      <img className="ui-auth-scene-fill" src={src} alt="" aria-hidden="true" decoding="async" />
      <img className="ui-auth-scene-pic" src={src} srcSet={srcSet} sizes={band ? '100vw' : '70vw'} alt="" decoding="async" fetchpriority="high" />
      {words ? (
        <p className="ui-auth-scene-title">
          <span>{words[0]}</span>
          <strong>{words[1]}</strong>
        </p>
      ) : null}
      {band ? null : (
        <div className="ui-auth-scene-top">
          <Quotes />
        </div>
      )}
    </div>
  );
}

export default function AuthLayout({ title, subtitle, wide = false, onHome, children, footer, brand, scene = 'signin' }) {
  /* The operator console brings its own brand side; the customer's doors get a picture. */
  const app = appFromHost();
  const file = brand ? null : sceneFile(scene, app);
  return (
    <div className={`ui-auth min-h-dvh${file ? ' has-scene' : ''}`}>
      <div className="ui-min-h-viewport flex">
        {file ? (
          <aside className="ui-auth-brand ui-auth-brand--scene hidden lg:flex" aria-label="About CLOR" style={{ '--scene-ratio': sceneRatio(file) }}>
            <Scene file={file} />
          </aside>
        ) : (
          <aside className={`ui-auth-brand hidden lg:flex${brand ? '' : ' is-board'}`} aria-label="About CLOR">
            <div className="ui-auth-brand-inner">
              <button type="button" onClick={onHome} className="text-left">
                <ClorLogo size={30} title="CLOR, back to clor.in" />
              </button>

              {brand || <CustomerBrand />}

              <p className="ui-caption">© 2026 CLOR Applications Private Limited</p>
            </div>
          </aside>
        )}

        <div className="ui-auth-side relative flex-1 flex flex-col items-center justify-center px-6 py-10">
          {file ? (
            <button type="button" onClick={onHome} className="ui-auth-back hidden lg:inline-flex">
              <span aria-hidden="true">←</span> Back to clor.in
            </button>
          ) : null}
          <div className={`relative w-full ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
            <div className="lg:hidden mb-6 text-center">
              <button type="button" onClick={onHome} className="inline-flex items-center gap-2">
                <ClorLogo size={30} title="CLOR, back to clor.in" />
              </button>
            </div>
            {file ? <Scene file={file} band /> : null}

            <div className="ui-auth-card ui-in">
              <div className="mb-7">
                {file ? (
                  /* Beside a picture the logo sits over the form, above the page's title (owner, 10 Nov 2026). */
                  <button type="button" onClick={onHome} className="ui-auth-form-logo hidden lg:inline-flex">
                    <ClorLogo size={30} title="CLOR, back to clor.in" />
                  </button>
                ) : null}
                <h1 className="ui-auth-form-title">{title}</h1>
                {subtitle ? <p className="ui-muted mt-2 text-sm">{subtitle}</p> : null}
              </div>

              {children}
            </div>

            {footer ? <div className="mt-6 text-center text-sm">{footer}</div> : null}
          </div>
          <div className="ui-auth-foot">
            <LegalLinks className="flex justify-center" />
            <p className="ui-auth-foot-line">© 2026 CLOR Applications Private Limited</p>
          </div>
        </div>
      </div>
    </div>
  );
}
