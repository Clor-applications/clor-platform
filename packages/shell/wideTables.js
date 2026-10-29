/* A list that fits the page lets the page scroll and keeps its head row stuck under the bar. One wider than
   the page (more columns than the window has room for) used to run past the right edge, cut open; it is
   marked `data-wide` so the stylesheet lets it scroll sideways inside the page instead (owner, 28 Oct 2026).

   Columns are fitted too (owner, 29 Oct 2026). A full-width table shared its spare width out unevenly (a
   date or a count floating in a wide gap), and handing all of it to one column made that column half the
   table. So each column's natural one-line width is measured once per set of rows, and:
   - when every column fits on one line, each gets its natural width plus a share of the spare width in
     proportion to it, so gaps stay even and no column outgrows the rest;
   - when they do not, short columns (up to FIT_MAX) keep one line at their natural width and the long ones
     (a name, a note) share what is left in the same proportion, wrapping, none below FLEX_MIN;
   - when even that does not fit, the table wraps as the browser lays it out.
   Tick boxes and row menus (up to FIXED_MAX) never grow; a width the screen set is kept as that column's least. */
/* Only the People look (data-palette="sky") styles data-wide and fits columns; in any other app the watcher does no work. */
const inUse = () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-palette') === 'sky';
const FIT_MAX = 200;
const FLEX_MIN = 160;
const FIXED_MAX = 56;
const CAP = 0.4;

/** One line per cell, the table at its content's width: what each column would like, read off its head cell. */
function naturalWidths(table, heads) {
  table.classList.add('ui-measure');
  const widths = heads.map((th) => th.getBoundingClientRect().width);
  table.classList.remove('ui-measure');
  return widths;
}

function fitColumns(table) {
  const heads = [...(table.tHead?.rows[0]?.cells || [])];
  const body = table.tBodies[0];
  if (heads.length < 2 || !body) return;
  /* Fitted again only when the rows or the room change, not on every repaint. */
  const room = table.parentElement.clientWidth;
  const sig = `${heads.length}:${body.rows.length}:${body.rows[0]?.textContent.length || 0}:${Math.round(room / 20)}`;
  if (table.dataset.fitSig === sig) return;
  table.dataset.fitSig = sig;
  /* A width the screen set (Leave balances' 8.5rem columns) is kept as that column's least, not as its only width. */
  const set = heads.map((th) => {
    if (th.dataset.ownMin) return Number(th.dataset.ownMin);
    if (!th.style.width || th.hasAttribute('data-fit-set')) return 0;
    const px = Math.round(th.getBoundingClientRect().width);
    th.dataset.ownMin = String(px);
    th.setAttribute('data-fit-set', '');
    return px;
  });
  const own = heads.map(() => false);
  const natural = naturalWidths(table, heads).map((w, i) => Math.max(w, set[i]));
  const fixed = natural.map((w, i) => !own[i] && w <= FIXED_MAX);
  const ownTotal = heads.reduce((sum, th, i) => sum + (own[i] ? th.getBoundingClientRect().width : 0), 0);
  const fixedTotal = natural.reduce((sum, w, i) => sum + (fixed[i] ? w : 0), 0);
  const free = (i) => !own[i] && !fixed[i];
  const short = natural.map((w, i) => free(i) && w <= FIT_MAX);
  const long = natural.map((w, i) => free(i) && w > FIT_MAX);
  const sumOf = (pick) => natural.reduce((sum, w, i) => sum + (pick[i] ? w : 0), 0);
  const growable = sumOf(natural.map((_, i) => free(i)));
  const left = room - ownTotal - fixedTotal;
  let width = natural.map(() => null);
  let oneLine = natural.map(() => false);
  /* Readable at its narrowest (for the side panel's room check): short columns whole, long ones at FLEX_MIN. */
  table.dataset.needs = String(Math.round(ownTotal + fixedTotal + sumOf(short) + long.filter(Boolean).length * FLEX_MIN));
  if (growable && growable <= left) {
    /* Spare width in proportion to content, but no column past CAP of the room (or its own content, if that is
       more): what a capped column cannot take goes to the others, so one long title cannot make half the table. */
    const grow = natural.map((w, i) => (free(i) ? w : 0));
    let share = grow.slice();
    let open = grow.map((w) => w > 0);
    for (let pass = 0; pass < 4; pass += 1) {
      const capped = grow.map((w, i) => (open[i] ? 0 : share[i]));
      const rest = left - capped.reduce((a2, b2) => a2 + b2, 0);
      const weight = grow.reduce((a2, w, i) => a2 + (open[i] ? w : 0), 0);
      if (!weight) break;
      let changed = false;
      share = grow.map((w, i) => {
        if (!open[i]) return share[i];
        const v = (w / weight) * rest;
        const cap = Math.max(w, CAP * left);
        if (v > cap) { open[i] = false; changed = true; return cap; }
        return v;
      });
      if (!changed) break;
    }
    width = natural.map((w, i) => (fixed[i] ? w : free(i) ? share[i] : null));
    oneLine = natural.map((_, i) => free(i) || fixed[i]);
  } else if (growable) {
    const longLeft = left - sumOf(short);
    const longTotal = sumOf(long);
    if (longTotal && longLeft >= long.filter(Boolean).length * FLEX_MIN) {
      width = natural.map((w, i) => (fixed[i] || short[i] ? w : long[i] ? Math.max(FLEX_MIN, (w / longTotal) * longLeft) : null));
      oneLine = natural.map((_, i) => fixed[i] || short[i]);
    }
  }
  heads.forEach((th, i) => {
    if (own[i]) return;
    th.toggleAttribute('data-fit', oneLine[i]);
    if (width[i] != null) { th.style.width = `${Math.floor(width[i])}px`; th.setAttribute('data-fit-set', ''); }
    else if (th.hasAttribute('data-fit-set')) { th.style.width = ''; th.removeAttribute('data-fit-set'); }
  });
  for (const row of body.rows) {
    [...row.cells].forEach((td, i) => { if (!own[i]) td.toggleAttribute('data-fit', Boolean(oneLine[i])); });
  }
}

export function watchWideTables(root) {
  if (!root || typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  /* A Set, not a WeakSet, so the boxes and tables that leave the page can be found and let go. */
  const watched = new Set();
  const forget = (el) => { ro.unobserve(el); watched.delete(el); };
  const check = (box) => {
    const table = box.querySelector(':scope > table');
    if (table) fitColumns(table);
    const wide = !!table && table.scrollWidth > box.clientWidth + 1;
    if (wide !== box.hasAttribute('data-wide')) box.toggleAttribute('data-wide', wide);
  };
  const ro = new ResizeObserver((entries) => entries.forEach((e) => {
    if (!e.target.isConnected) return;
    const box = e.target.closest('.ui-table-scroll');
    if (box) check(box);
  }));
  /* A list swaps its loading rows for the real table, so every change re-checks and watches what is new. */
  const scan = () => {
    /* Lists that went with the last screen are no longer watched; outside People nothing is. */
    const use = inUse();
    watched.forEach((el) => { if (!use || !el.isConnected) forget(el); });
    if (!use) return;
    root.querySelectorAll('#main-content .ui-table-scroll').forEach((box) => {
      for (const el of [box, box.querySelector(':scope > table')]) {
        if (el && !watched.has(el)) { watched.add(el); ro.observe(el); }
      }
      check(box);
    });
  };
  let queued = 0;
  const mo = new MutationObserver(() => {
    if (queued || (!watched.size && !inUse())) return;
    queued = setTimeout(() => { queued = 0; scan(); }, 60);
  });
  scan();
  mo.observe(root, { childList: true, subtree: true });
  return () => { mo.disconnect(); ro.disconnect(); watched.clear(); clearTimeout(queued); };
}
