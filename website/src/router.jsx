import React, { createContext, useContext, useEffect, useState } from 'react';

/*
 * A router for a site with a fixed set of pages: every page is prerendered to
 * its own HTML file, and in the browser links move between them without a
 * reload. No dependency needed for that.
 */
const PathContext = createContext('/');
export const usePath = () => useContext(PathContext);

const clean = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p) || '/';

export function Router({ initialPath, children }) {
  const [path, setPath] = useState(clean(initialPath));
  useEffect(() => {
    const onPop = () => setPath(clean(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    const go = (e) => {
      const to = e.detail;
      window.history.pushState({}, '', to);
      setPath(clean(new URL(to, window.location.href).pathname));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('clor:navigate', go);
    return () => window.removeEventListener('clor:navigate', go);
  }, []);
  return <PathContext.Provider value={path}>{children}</PathContext.Provider>;
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
