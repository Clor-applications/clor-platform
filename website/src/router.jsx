import React, { createContext, useContext, useEffect, useState } from 'react';

/*
 * A router for a site with a fixed set of pages: every page is prerendered to
 * its own HTML file, and in the browser links move between them without a
 * reload. No dependency needed for that.
 *
 * The context carries the path and the query (?about=, ?app=), so a page
 * that reads the query hears about it when an in-page link changes it.
 * Each history entry remembers its scroll position; Back and Forward put the
 * reader where they were, a new page opens at the top.
 */
const LocationContext = createContext({ path: '/', search: '' });
export const usePath = () => useContext(LocationContext).path;
export const useSearch = () => useContext(LocationContext).search;

const clean = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p) || '/';
const here = () => ({ path: clean(window.location.pathname), search: window.location.search });

export function Router({ initialPath, children }) {
  const [loc, setLoc] = useState({ path: clean(initialPath), search: '' });
  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    /* The query is only known in the browser; read it on the next frame, not inside the effect. */
    const frame = requestAnimationFrame(() => setLoc(here()));
    const onPop = (e) => {
      setLoc(here());
      const y = e.state?.scrollY ?? 0;
      requestAnimationFrame(() => window.scrollTo({ top: y }));
    };
    window.addEventListener('popstate', onPop);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('popstate', onPop);
    };
  }, []);
  useEffect(() => {
    const go = (e) => {
      const to = e.detail;
      /* Remember where this page was left, for Back. */
      window.history.replaceState({ ...window.history.state, scrollY: window.scrollY }, '');
      window.history.pushState({ scrollY: 0 }, '', to);
      setLoc(here());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('clor:navigate', go);
    return () => window.removeEventListener('clor:navigate', go);
  }, []);
  return <LocationContext.Provider value={loc}>{children}</LocationContext.Provider>;
}

/** An internal link: a real <a href> (crawlable, opens in a new tab), handled in place when clicked plainly. */
export function Link({ href, children, onClick, ...rest }) {
  const internal = href.startsWith('/') && !href.startsWith('//');
  const handle = (e) => {
    onClick?.(e);
    if (!internal || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('clor:navigate', { detail: href }));
  };
  return (
    <a href={href} onClick={handle} {...rest}>
      {children}
    </a>
  );
}
