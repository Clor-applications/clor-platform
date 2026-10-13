import { useEffect } from 'react';

/**
 * Make the scrolling part of a page end where the screen ends.
 *
 * Every list already scrolls its rows rather than the page, but the height it
 * was given was a guess — `100dvh - 21rem`, one number for screens that carry
 * five summary tiles, a filter band and a tab strip and for screens that carry
 * none of it. Too tall and the page scrolled as well as the rows, which is the
 * double scrollbar; too short and a third of the window sat empty under the
 * table.
 *
 * So it is measured instead: whatever the chrome above a scroller turns out to
 * be, the scroller gets the rest of the window minus the room its own card
 * needs underneath. Re-measured when the screen changes, when the window
 * resizes, and when anything above it grows — a filter band opening, a wrapped
 * toolbar, a company banner appearing.
 *
 * Not a substitute for a page that is honestly longer than a screen: a
 * dashboard of panels still scrolls, and should. This is for the one region on
 * a page that holds the rows.
 */
export function useFitToViewport(dep) {
  useEffect(() => {
    const root = document.getElementById('main-content');
    if (!root) return undefined;

    let frame = 0;

    const measure = () => {
      frame = 0;
      const scrollers = [...root.querySelectorAll('.ui-table-scroll')];
      for (const el of scrollers) {
        /* Clear first, or every pass measures the height set by the last one
           and the region walks up the page. */
        el.style.removeProperty('--table-scroll-h');
        const top = el.getBoundingClientRect().top;

        /* What still has to fit under it: the rest of the card it sits in —
           a pagination bar, a footnote — plus the page's own bottom padding. */
        const card = el.closest('.ui-card') || el.parentElement;
        const below = card ? Math.max(0, card.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom) : 0;

        /* The page's own bottom padding, read rather than assumed: it is 20px
           at one breakpoint and 24 at another, and guessing it low leaves the
           page scrolling by exactly the few pixels that were guessed wrong. */
        const gutter = parseFloat(getComputedStyle(root).paddingBottom) || 0;
        const rootBottom = root.getBoundingClientRect().bottom;
        const viewportBottom = el.hasAttribute('data-fill-viewport')
          ? window.innerHeight
          : rootBottom > top
          ? Math.min(window.innerHeight, rootBottom)
          : window.innerHeight;
        const available = viewportBottom - top - below - gutter - 2;
        /* Below this a table is not worth showing and the page may scroll. */
        el.style.setProperty('--table-scroll-h', `${Math.max(160, Math.round(available))}px`);
      }

      /*
       * Then correct by what is actually left over.
       *
       * Measuring from the scroller's own top accounts for everything above it
       * and nothing below it — a tip under the card, a footnote, the page's own
       * trailing margin — so the page was still scrolling by exactly the height
       * of whatever came after. The remainder is read off the page itself and
       * taken from the tallest region, which is the one that can spare it.
       */
      if (!scrollers.length) return;
      const over = root.scrollHeight - root.clientHeight;
      if (over <= 0) return;

      /* Full-page report grids deliberately own all remaining screen height.
         Their pager floats inside the grid, so there is no content after the
         scroller to compensate for. Including them in the overflow correction
         shortened the grid by the old report card height and left a large
         blank strip below its horizontal scrollbar. */
      const correctableScrollers = scrollers.filter((el) => !el.hasAttribute('data-fill-viewport'));
      if (!correctableScrollers.length) return;

      const tallest = correctableScrollers.reduce((a, b) =>
        a.getBoundingClientRect().height >= b.getBoundingClientRect().height ? a : b
      );
      const now = tallest.getBoundingClientRect().height;
      tallest.style.setProperty('--table-scroll-h', `${Math.max(160, Math.round(now - over))}px`);
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    /*
     * Twice, and again when the fonts land.
     *
     * Measured on the first frame the rows are still in a fallback face, the
     * chrome above is taller than it will be, and every table came out at the
     * 160px floor — a third of the window empty under a table showing four
     * rows. The second frame has the real layout; `fonts.ready` covers a face
     * that arrives later still.
     */
    schedule();
    requestAnimationFrame(() => requestAnimationFrame(schedule));
    if (document.fonts?.ready) document.fonts.ready.then(schedule).catch(() => {});
    window.addEventListener('resize', schedule);

    /* Anything above the table growing moves the table down. */
    const observer = new ResizeObserver(schedule);
    observer.observe(root);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
    };
  }, [dep]);
}

export default useFitToViewport;
