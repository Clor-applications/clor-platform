import { useEffect, useRef } from 'react';

/**
 * Put the screen in the address bar.
 *
 * The application has never had one there: which screen you are on lives in a
 * single piece of state, so reloading dropped you back on Home, the browser's
 * Back button left the product altogether, and there was no way to send anybody
 * a link to anything. Three separate complaints with one cause.
 *
 * A hash rather than a path, deliberately: a path needs the server to answer
 * every URL with the application, and this one serves a static build behind a
 * reverse proxy. `#/invoices` reloads correctly on any host, today, with no
 * deploy configuration to get wrong.
 *
 * What is *not* in the URL: which document is open in an editor, what a filter
 * is set to, which tab of a form. Those are worth having eventually and none of
 * them is worth a half-built version now — a link that restores the screen but
 * not the document is a link that lies about where it goes.
 */

const keyFromHash = () => {
  const raw = String(window.location.hash || '').replace(/^#\/?/, '').trim();
  return raw.split('?')[0].split('/')[0] || '';
};

export function useScreenUrl({ active, setActive, isKnown }) {
  /* The screen the URL last said, so a write does not read back as a visit. */
  const ours = useRef(null);
  const started = useRef(false);
  /* Whether this hook has written the address bar yet, which decides replace
     against push — pushing the first would put an empty entry behind the
     application and one Back press would appear to do nothing. */
  const wrote = useRef(false);

  /* Read on open: a reload, or a link somebody was sent. */
  useEffect(() => {
    const wanted = keyFromHash();
    if (wanted && wanted !== active && isKnown(wanted)) {
      ours.current = wanted;
      setActive(wanted);
    }
    started.current = true;
    // Once, on open. The hash is authority only at that moment; after it, the
    // screen is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Write on move. */
  useEffect(() => {
    if (!active) return;

    /*
     * The URL is ahead of the screen, so leave it alone.
     *
     * Both effects run on the same mount: the one above reads `#/settingsTax`
     * and asks for that screen, and this one runs before the state has changed
     * — with `active` still the default. Writing here replaced the link
     * somebody had just followed with the screen they were leaving, and the
     * address bar said dashboard on a page showing tax settings.
     */
    if (ours.current && ours.current !== active) return;

    if (ours.current === active) {
      ours.current = null;
      return;
    }
    const next = `#/${active}`;
    if (window.location.hash === next) return;

    /*
     * The first screen replaces; every move after it pushes. Pushing the first
     * would put an empty entry behind the application, so one Back press would
     * appear to do nothing.
     */
    if (!wrote.current) {
      wrote.current = true;
      window.history.replaceState(null, '', next);
    } else {
      window.history.pushState(null, '', next);
    }
  }, [active]);

  /* Follow Back and Forward. */
  useEffect(() => {
    const onPop = () => {
      const wanted = keyFromHash();
      if (!wanted || !isKnown(wanted)) return;
      ours.current = wanted;
      setActive(wanted);
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, [setActive, isKnown]);
}

export default useScreenUrl;
