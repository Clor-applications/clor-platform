import React, { Suspense, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from '@ui/components/ui/lineIcons';
import { useContentIcon } from '@ui/components/ui/colorSwap';

/**
 * The side panel beside a list (owner, 28 Oct 2026): what you want to know
 * before acting on the list, in the width the table leaves free. A few lines
 * per block; every line either opens the page it names or narrows the list.
 *
 * An app opts a screen in from its manifest (`withSidePanel(Screen, Panel)`),
 * so a shared screen gets the panel in People and stays as it is elsewhere.
 * The panel is drawn, and its data fetched, only when the page is wide enough
 * for both: 56rem of content, and room left for the list's table at its
 * natural width (every column as wide as what it holds). A wide table, a
 * laptop with the module panel open, and every phone keep the list on its own.
 */
/* 900px of content (was 1056, owner 29 Oct 2026: a laptop showed lists edge to edge with nothing beside them). */
const WIDE = 900;
const PANEL = 280; // 16rem and the 1.5rem gap before it

/*
 * The table's own width, measured with the table let go of the page's width
 * for a moment (it fills the page otherwise, sharing out the spare width). No table yet (still loading): no
 * panel yet either, so it never appears only to leave again.
 */
const tableNeeds = (root) => {
  const table = root?.querySelector('.ui-table');
  /* Still loading: wait. Loaded and empty (no table at all): nothing to make room for, so the panel may show. */
  if (!table) return root?.querySelector('[aria-busy="true"], .ui-skel') ? Infinity : 0;
  /* At its narrowest readable width, as the column fitter worked it out (wideTables.js: short columns whole,
     long ones wrapping down to 160px), so a note column no longer keeps the panel away. */
  if (table.dataset.needs) return Number(table.dataset.needs);
  const was = table.style.width;
  table.style.width = 'auto';
  const w = table.getBoundingClientRect().width;
  table.style.width = was;
  return w;
};

export function withSidePanel(Screen, Panel) {
  const Wrapped = (props) => {
    const ref = useRef(null);
    const main = useRef(null);
    const [wide, setWide] = useState(false);
    useLayoutEffect(() => {
      const el = ref.current;
      if (!el || typeof ResizeObserver === 'undefined') return undefined;
      const measure = () => {
        const w = el.getBoundingClientRect().width;
        setWide(w >= WIDE && w - PANEL >= tableNeeds(main.current));
      };
      measure();
      /* Measured again when the window changes and when the page's rows arrive or a tab swaps the table, at most every 80ms. */
      let timer = 0;
      const soon = () => { if (!timer) timer = setTimeout(() => { timer = 0; measure(); }, 80); };
      const ro = new ResizeObserver(soon);
      ro.observe(el);
      const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(soon);
      if (main.current) mo?.observe(main.current, { childList: true, subtree: true });
      return () => { ro.disconnect(); mo?.disconnect(); clearTimeout(timer); };
    }, []);
    return (
      <div ref={ref} className="ui-with-panel" data-panel={wide ? 'on' : undefined}>
        <div ref={main} className="ui-with-panel-main"><Screen {...props} /></div>
        {wide ? (
          <aside className="ui-side-panel" aria-label="About this list">
            <p className="ui-side-today">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            {/* Its own wait: a panel still loading never holds up the list. */}
            <Suspense fallback={null}><Panel {...props} /></Suspense>
          </aside>
        ) : null}
      </div>
    );
  };
  Wrapped.displayName = `WithSidePanel(${Screen.displayName || Screen.name || 'Screen'})`;
  return Wrapped;
}

/** One block: a heading with its count, the lines, and an optional link on the right. Nothing to say, nothing drawn. */
export function SideBlock({ title, count, action, children }) {
  const items = React.Children.toArray(children).filter(Boolean);
  if (!items.length) return null;
  return (
    <section className="ui-side-block">
      <div className="ui-side-head">
        <h2 className="ui-side-title">
          {title}
          {count ? <span className="ui-side-count">{count}</span> : null}
        </h2>
        {action ? <button type="button" className="ui-side-more" onClick={action.onClick}>{action.label}</button> : null}
      </div>
      <div className="ui-side-lines">{items}</div>
    </section>
  );
}

/**
 * A line: a mark on the left (a face, a date tile), the words, and on the
 * right either a figure or a status in its pill. A line that goes somewhere is
 * a button; one that only informs is not.
 */
export function SideLine({ lead, title, sub, meta, tone, onClick, bar }) {
  const hasMeta = meta !== undefined && meta !== null && meta !== '';
  const body = (
    <>
      {lead ? <span className="ui-side-lead">{lead}</span> : null}
      <span className="ui-side-text">
        <span className="ui-side-name">{title}</span>
        {sub ? <span className="ui-side-sub">{sub}</span> : null}
        {bar !== undefined ? <span className="ui-side-bar" aria-hidden="true"><span style={{ width: `${Math.max(4, Math.min(100, bar))}%` }} /></span> : null}
      </span>
      {hasMeta ? <span className={tone && tone !== 'count' ? 'ui-side-pill' : 'ui-side-meta'} data-tone={tone || undefined}>{meta}</span> : null}
    </>
  );
  return onClick ? (
    <button type="button" className="ui-side-line" onClick={onClick}>{body}</button>
  ) : (
    <div className="ui-side-line">{body}</div>
  );
}

/** Something to act on before anything else (a team short-handed, a document lapsed): one tinted line with its sign. */
export function SideAlert({ title, sub, tone = 'neg', onClick }) {
  const body = (
    <>
      <AlertTriangle size={16} aria-hidden="true" />
      <span className="ui-side-text">
        <span className="ui-side-name">{title}</span>
        {sub ? <span className="ui-side-sub">{sub}</span> : null}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className="ui-side-alert" data-tone={tone} onClick={onClick}>{body}</button>
  ) : (
    <div className="ui-side-alert" data-tone={tone} role="note">{body}</div>
  );
}

/** A calm "all clear" in place of an empty block. */
export function SideClear({ children }) {
  return (
    <div className="ui-side-clear">
      <CheckCircle2 size={16} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/** What happened, newest first, as a thin timeline: a dot in the outcome's colour, what, and how long ago. */
export function SideTimeline({ items }) {
  const shown = (items || []).filter(Boolean);
  if (!shown.length) return null;
  return (
    <ol className="ui-side-timeline">
      {shown.map((it) => (
        <li key={it.key} data-tone={it.tone || undefined}>
          <span className="ui-side-dot" aria-hidden="true" />
          <span className="ui-side-text">
            <span className="ui-side-name">{it.title}</span>
            {it.sub ? <span className="ui-side-sub">{it.sub}</span> : null}
          </span>
          <time className="ui-side-meta" dateTime={new Date(it.at).toISOString()}>{ago(it.at)}</time>
        </li>
      ))}
    </ol>
  );
}

/** A day as a small calendar leaf: the month over the date. */
export function DateTile({ iso }) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return (
    <span className="ui-side-date" aria-hidden="true">
      <span>{d.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' })}</span>
      <b>{d.getUTCDate()}</b>
    </span>
  );
}

/**
 * Where to go next: small chips with their icons, two to a row. A link that
 * names its `screen` shows only when that screen is in `navItems` (the nav the
 * shell kept for this person), so nobody is sent to a page that refuses them.
 */
export function SideLinks({ links, navItems = null }) {
  const mark = useContentIcon();
  const open = Array.isArray(navItems) && navItems.length ? new Set(navItems.map((i) => i.key)) : null;
  const shown = (links || []).filter((l) => l && (!l.screen || !open || open.has(l.screen))).map((l) => ({ ...l, icon: mark(l.icon) }));
  if (!shown.length) return null;
  return (
    <section className="ui-side-block">
      <div className="ui-side-head"><h2 className="ui-side-title">Quick links</h2></div>
      <div className="ui-side-chips">
        {shown.map(({ label, onClick, icon: Icon }) => (
          <button key={label} type="button" className="ui-side-chip" onClick={onClick}>
            {Icon ? <Icon size={14} aria-hidden="true" /> : null}
            <span>{label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** "2h", "3d", "just now": how long ago, short enough for the right edge. */
export function ago(at) {
  const ms = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(ms)) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
