import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { addLeaveGuard, hasUnsaved, mayLeave, scrollOnPop } from './history.js';

/*
 * A router for a site with a fixed set of pages: every page is prerendered to
 * its own HTML file, and in the browser links move between them without a
 * reload. No dependency needed for that.
 *
 * The context carries the path and the query (?about=, ?app=), so a page
 * that reads the query hears about it when an in-page link changes it.
 * Each history entry remembers its scroll position; Back and Forward put the
 * reader where they were, a new page opens at the top, and a "#section"
 * link lands on its section and stays there.
 */
const LocationContext = createContext({ path: '/', search: '' });
export const usePath = () => useContext(LocationContext).path;
export const useSearch = () => useContext(LocationContext).search;

const clean = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p) || '/';
const here = () => ({ path: clean(window.location.pathname), search: window.location.search });

export function Router({ initialPath, children }) {
  const [loc, setLoc] = useState({ path: clean(initialPath), search: '' });
  /* The page the reader is on, for telling a page change from a hash change on Back. */
  const at = useRef(clean(initialPath));
  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    /* The query is only known in the browser; read it on the next frame, not inside the effect. */
    const frame = requestAnimationFrame(() => setLoc(here()));
    at.current = clean(window.location.pathname);
    const onPop = (e) => {
      const next = here();
      const y = scrollOnPop(at.current, next.path, e.state);
      at.current = next.path;
      setLoc(next);
      if (y !== null) requestAnimationFrame(() => window.scrollTo({ top: y }));
    };
    /* A "#section" link adds a history entry; remember where the reader was, so Back returns there. */
    const onHashClick = (e) => {
      const a = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
      if (a && !e.defaultPrevented) window.history.replaceState({ ...window.history.state, scrollY: window.scrollY }, '');
    };
    /* A reload or an outside link with unsaved work: the browser's own question. */
    const onUnload = (e) => {
      if (!hasUnsaved()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('click', onHashClick, true);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('click', onHashClick, true);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);
  useEffect(() => {
    const go = (e) => {
      const to = e.detail;
      /* A half-filled form asks first. */
      if (!mayLeave((m) => window.confirm(m))) return;
      /* Remember where this page was left, for Back. */
      window.history.replaceState({ ...window.history.state, scrollY: window.scrollY }, '');
      window.history.pushState({ scrollY: 0 }, '', to);
      const next = here();
      at.current = next.path;
      setLoc(next);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('clor:navigate', go);
    return () => window.removeEventListener('clor:navigate', go);
  }, []);
  return <LocationContext.Provider value={loc}>{children}</LocationContext.Provider>;
}

/**
 * Unsaved work on this page: while dirty is true, an in-site link asks before
 * leaving and the browser asks before a reload.
 */
export function useLeaveGuard(dirty, message) {
  const now = useRef({ dirty: false, message });
  useEffect(() => {
    now.current = { dirty: Boolean(dirty), message };
  });
  useEffect(() => {
    const off = addLeaveGuard({ dirty: () => now.current.dirty, message: () => now.current.message });
    return off;
  }, []);
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
