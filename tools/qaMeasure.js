/**
 * What a screen actually measures, at whatever viewport the pane is emulating.
 *
 * Loaded by hand during a QA pass, never by the application. It lives outside
 * `src/` and outside `public/` on purpose: anything under `public/` is copied
 * into `dist/` verbatim, and a debugging helper has no business being served
 * from production. Read this file and evaluate its text in the page instead.
 *
 * Judgement it deliberately does not make: it reports numbers, and whether a
 * number is a defect is decided against the geometry rules, not here.
 */
window.measureViewport = () => {
  const doc = document.documentElement;
  const px = (el, p) => (el ? Math.round(parseFloat(getComputedStyle(el)[p]) || 0) : null);
  const w = (el) => (el ? Math.round(el.getBoundingClientRect().width) : null);

  const sidebar = document.querySelector('aside, [class*="sidebar"], .ui-nav-scroll')?.closest('aside, div');
  const main = document.querySelector('main') || doc.querySelector('.ui-app-shell > div:last-child');
  const h1 = document.querySelector('h1, h2');

  /*
   * Page overflow is the defect; a container that scrolls on purpose is not.
   * So anything with its own overflow is excluded before asking which boxes
   * stick out of the viewport.
   */
  const inScroller = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const o = getComputedStyle(n).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  };

  const tooWide = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= doc.clientWidth + 1) continue;
    if (inScroller(el)) continue;
    tooWide.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} → ${Math.round(r.right)}px`);
  }

  /*
   * Content laid out past the right edge of the card it belongs to.
   *
   * This is the failure the viewport check above misses, and it is the worse
   * of the two: an element outside its panel but still inside the window
   * draws over whatever is beside it, and there is no scrollbar to say so.
   * A money figure rendered 125px past its own card is not "slightly tight" —
   * it is in the next panel.
   */
  const escapes = [];
  for (const card of document.querySelectorAll('.ui-card, .ui-surface, .ui-doc-section')) {
    const box = card.getBoundingClientRect();
    for (const el of card.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || inScroller(el)) continue;
      const over = Math.round(r.right - box.right);
      if (over <= 1) continue;
      escapes.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} +${over}px past ${String(card.getAttribute('aria-label') || card.className).slice(0, 24)}`);
    }
  }

  const heights = (sel) =>
    [...document.querySelectorAll(sel)].map((e) => Math.round(e.getBoundingClientRect().height)).filter(Boolean);

  const uniq = (a) => [...new Set(a)].sort((x, y) => x - y);

  /*
   * The nearest ancestor that actually scrolls, read from computed style
   * rather than from a class name — `.ui-table-scroll` carries the overflow
   * in the stylesheet and has no "overflow" in its class, so matching on the
   * name walked straight past it to the card, which is `overflow: hidden`,
   * and reported a scrolling table as clipped.
   */
  const scrollerFor = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const o = getComputedStyle(n).overflowX;
      if (o === 'auto' || o === 'scroll') return n;
    }
    return null;
  };

  const tables = [...document.querySelectorAll('table')].map((t) => {
    const box = scrollerFor(t);
    return {
      table: w(t),
      container: (box || t.parentElement)?.clientWidth ?? null,
      /* No scroller at all and a table wider than the space it is given means
         the columns past the edge cannot be reached by any means. */
      clipped: !box && t.parentElement ? w(t) > t.parentElement.clientWidth + 1 : false,
      scrolls: box ? box.scrollWidth > box.clientWidth : false,
    };
  });

  return {
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    sidebar: w(sidebar),
    content: w(main),
    pagePadding: main ? `${px(main, 'paddingTop')} / ${px(main, 'paddingLeft')}` : null,
    titleX: h1 ? Math.round(h1.getBoundingClientRect().left) : null,
    pageOverflow: doc.scrollWidth > doc.clientWidth,
    boxesPastViewport: tooWide.slice(0, 6),
    escapesItsCard: [...new Set(escapes)].slice(0, 6),
    tables,
    controlHeights: {
      input: uniq(heights('.ui-input')),
      select: uniq(heights('.ui-select')),
      button: uniq(heights('.ui-btn')),
    },
    fontSizes: uniq([...document.querySelectorAll('.ui-label')].map((e) => Math.round(parseFloat(getComputedStyle(e).fontSize)))),
  };
};
