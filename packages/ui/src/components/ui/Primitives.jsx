import { usePeoplePageSlot } from '../list/PeoplePageLayout';
import React from 'react';
import { cva } from 'class-variance-authority';
import { Check, ChevronRight, X } from '@ui/components/ui/lineIcons';

/* Books keeps its text cross on a filter chip; every other app draws the Lucide X. */
const inBooks = () => typeof document !== 'undefined' && document.documentElement.dataset.palette === 'indigo';

import Illustration from './Illustration';
import { CountLine } from './CountLine';
import { iconFor } from './entityIdentity';
import { resolveStatus } from '../../utils/statusRegistry';
import { enumWords } from '../../utils/errorWords.js';

/**
 * Shared UI primitives for the app shell.
 * Styling lives in src/index.css as token-driven `.ui-*` classes, so these
 * components never carry raw hex values and both themes stay in sync.
 */

/**
 * Page header: title, optional description, right-aligned actions.
 *
 * The action row wraps rather than holding its width. It was `shrink-0`, so on
 * a 375px screen a search box, two buttons and a split primary measured 363px
 * and ended 4px past the viewport — with the page itself not scrolling
 * sideways, which meant the caret half of "New Invoice" could not be reached at
 * all and its menu was unopenable on a phone. Wrapping costs a row of height;
 * `shrink-0` cost the control.
 */
/**
 * The mark beside a page title.
 *
 * It says which part of the book you are in, in the colour family that part
 * owns — sales blue, purchase violet, inventory ochre. Never the brand: the
 * brand is on the button to its right, and if both wore it the page and the
 * thing you can do on it would look the same.
 *
 * `entity` is a key from entityIdentity, so a screen names what it holds
 * rather than choosing an icon and a colour for itself.
 */
export const EntityMark = ({ entity, size = 18 }) => {
  const icon = iconFor(entity);
  if (!icon) return null;
  return (
    <span
      /* The brand, not the area's colour.
         Eleven category hues told the areas apart and read as grey at 18px on
         a near-white tile — the mark was doing identity work nobody could see.
         One orange on a tint of itself is legible at a glance and says
         "this is CLOR"; which area you are in is what the title beside it
         and the rail's own coloured icon already say. */
      className="ui-entity-mark grid h-8 w-8 shrink-0 place-items-center rounded-lg"
      /* Outside Books the mark is neutral, a hairline tile in ink: the app colour has four jobs and a
         page mark is not one of them (DESIGN.md "Colour has one job"). Books keeps its tinted mark. */
      style={loadsWithSpinner() ? { border: '1px solid rgb(var(--border))', color: 'rgb(var(--fg))' } : { backgroundColor: 'rgb(var(--brand) / 0.12)', color: 'rgb(var(--brand-ink))' }}
      aria-hidden="true"
    >
      {/* createElement, not <Icon />: the linter reads a capitalised local as
          a component declared inside a render. It is a lookup, not a
          declaration — the same function object comes back every time. */}
      {React.createElement(icon, { size, strokeWidth: 2.1 })}
    </span>
  );
};

/* `breadcrumb`: [{ label, onClick? }] — the trail above the title (People design spec v1 §5); the last item is the current page.
   `counts`: the count line under the title (DESIGN.md "Page header"; design audit G6), either CountLine items
   ([{ label, value, onClick? }], zero clauses left out) or a ready line of text. One primary goes in `actions`. */
export const PageHeader = ({
  title, description, introduction, actions = null, entity = '', breadcrumb = null, counts = null, summary = null,
}) => {
  // People omits introductory copy on shared screens. Record details and operational notices still appear.
  const inPeople = typeof document !== 'undefined' && document.documentElement.dataset.app === 'people';
  const [helpSlot, peopleLayout] = usePeoplePageSlot('heading');
  const lead = inPeople ? undefined : introduction;
  const caption = lead && description ? <>{lead} {description}</> : lead || description;
  return (
    <div className="ui-page-heading flex flex-wrap items-start justify-between gap-3 mb-2">
      {/* The title gives way before the actions do: they stay top right until the title would be narrower than 20rem. */}
      <div className="flex min-w-0 items-center gap-2.5" style={{ flex: '1 1 20rem' }}>
        {entity ? <EntityMark entity={entity} /> : null}
        <div className="min-w-0">
          {!peopleLayout && breadcrumb?.length ? (
            <nav aria-label="Breadcrumb" className="ui-breadcrumb">
              <ol>
                {breadcrumb.map((b, i) => (
                  <li key={`${b.label}-${i}`}>
                    {i > 0 && <ChevronRight size={12} aria-hidden="true" />}
                    {i < breadcrumb.length - 1 && b.onClick ? <button type="button" className="ui-link" onClick={b.onClick}>{b.label}</button> : <span aria-current={i === breadcrumb.length - 1 ? 'page' : undefined}>{b.label}</span>}
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          <h1 className="ui-t-page">{title}</h1>
          {summary}
          {Array.isArray(counts) ? <CountLine items={counts} /> : counts ? <p className="ui-count-line">{counts}</p> : null}
          {caption ? <p className="ui-muted ui-t-body mt-0.5" title={typeof caption === 'string' ? caption : undefined}>{caption}</p> : null}
        </div>
      </div>
      {actions || helpSlot ? (
        <div className="ui-heading-actions flex flex-wrap items-center justify-end gap-2 min-w-0 max-w-full">{helpSlot && <span className="people-help-slot" ref={helpSlot} />}{actions}</div>
      ) : null}
    </div>
  );
};

/**
 * Metric tile. `tone` colours the value for financial meaning only
 * (pos = money in, neg = money owed), never for decoration.
 */
export const StatTile = ({ label, value, hint, tone = 'neutral', icon: Icon = null, amount = null, format = null, title = null }) => {
  const toneClass = tone === 'pos' ? 'ui-amount-pos' : tone === 'neg' ? 'ui-amount-neg' : '';
  /* The figure is printed, not counted up to. An accountant opens this screen
     to read a number; animating it means the number cannot be read until the
     animation finishes, and the tile is on screen for seconds at a time. */
  const shown = amount !== null && typeof format === 'function' ? format(amount ?? 0) : value;

  // Same KPI voice as the main dashboard: small quiet label, 42px figure,
  // caption underneath. One language for a number-on-a-card everywhere, so a
  // module overview no longer reads as an older generation of the product.
  return (
    <div className="ui-stat">
      <div className="flex items-center justify-between gap-2">
        <span className="ui-card-label">{label}</span>
        {Icon ? (
          <Icon
            size={16}
            className="ui-subtle"
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className={`ui-kpi ${toneClass}`} title={title || undefined}>{shown}</div>
      {hint ? <div className="ui-caption">{hint}</div> : null}
    </div>
  );
};

/**
 * A row of headline figures on one surface, divided by hairlines.
 *
 * Separate cards give each number its own border, shadow and gutter, which is
 * four boxes fighting for the same glance. One strip puts them on a single
 * baseline so they read as a set, which is what a summary is.
 *
 * Paise are rendered a size down and muted: scanning money means reading the
 * rupees, and the decimals are there for checking, not for scanning.
 */
export const StatStrip = ({ items = [], className = '' }) => {
  if (!items.length) return null;

  return (
    <div className={`ui-strip ${className}`.trim()}>
      {items.map((it, i) => {
        const shown = String(it.value ?? '');
        // Split on the last separator so Indian grouping (12,30,340.69) keeps
        // its lakh commas in the whole part.
        const cut = shown.lastIndexOf('.');
        const whole = cut > -1 ? shown.slice(0, cut) : shown;
        const frac = cut > -1 ? shown.slice(cut) : '';

        const dir = typeof it.delta === 'number' ? (it.delta > 0 ? 'pos' : it.delta < 0 ? 'neg' : null) : null;
        const deltaClass =
          it.deltaTone === 'muted' || dir === null
            ? ''
            : dir === 'pos'
              ? 'ui-strip-delta-pos'
              : 'ui-strip-delta-neg';

        return (
          <div key={it.key || it.label || i} className="ui-strip-cell">
            <span className="ui-t-label">{it.label}</span>
            <span className="ui-strip-figure" title={it.title || undefined}>
              {whole}
              {frac ? <span className="ui-strip-frac">{frac}</span> : null}
            </span>
            {typeof it.delta === 'number' ? (
              <span className={`ui-strip-delta ${deltaClass}`}>
                <span aria-hidden="true">{it.delta > 0 ? '\u2197' : it.delta < 0 ? '\u2198' : '\u2192'}</span>
                {Math.abs(it.delta).toFixed(1)}%
                <span className="sr-only">{it.delta > 0 ? ' up' : it.delta < 0 ? ' down' : ' flat'} on last period</span>
              </span>
            ) : it.hint ? (
              <span className="ui-caption">{it.hint}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

/**
 * A document's concise status.
 *
 * Tone comes from the registry rather than from a list kept here, so a status
 * added anywhere in the product either registers itself or arrives visibly
 * unknown. It used to arrive grey, which is how eleven of twenty-one statuses
 * ended up meaning nothing — `Draft` and `Unpaid` were the same pill.
 * Status columns stay to one compact label. Amounts, dates and settlement
 * detail belong in their own columns or in the document view.
 */
export const StatusPill = ({ status }) => {
  const { label, tone, statusTone, known } = resolveStatus(status);

  /*
   * A document status that has a colour of its own wears it — the same four
   * values the filter tabs use, so Paid is the same green in the tab strip,
   * in the Status column and anywhere else the document is listed. Statuses
   * outside that set (approvals, transfers) keep the generic pos/neg/warn
   * pills; they are not invoice states and inventing a hue for each would
   * spend the palette on distinctions nobody makes.
   */
  return (
    <span
      data-tone={statusTone || undefined}
      className={statusTone ? 'ui-pill ui-pill-status' : `ui-pill ui-pill-${tone}`}
      title={known || !import.meta.env?.DEV ? undefined : `Unregistered status: ${label}`}
      style={known || !import.meta.env?.DEV ? undefined : { outline: '1px dashed rgb(var(--neg))', outlineOffset: '1px' }}
    >
      {!known && /^[A-Z][A-Z0-9_]+$/.test(label) ? enumWords(label) : label}
    </span>
  );
};

/** Empty state with an optional call to action. */
/**
 * What a screen says when it has nothing to show.
 *
 * Three situations, three answers, because they are not the same thing:
 *
 *   new       nothing has ever been created here
 *   filtered  records exist, the filters are hiding all of them
 *   disabled  the module is switched off for this company
 *
 * The middle one is the reason this exists. With per-column filters on every
 * list, filtering to nothing is a daily event, and an accountant who knows
 * there are 77 orders reads "No purchase orders found" as data loss. Saying
 * "all 77 are still here, three filters are hiding them" is the difference
 * between a shrug and a support call.
 */
export const EmptyState = ({
  icon: Icon = null,
  title,
  description,
  action = null,
  kind = 'new',
  /** How many records exist behind the filters. Shown so the count is visible. */
  totalCount = null,
  /** [{ label, value, onRemove }] — the filters doing the hiding. */
  filters = [],
  onClearFilters = null,
  /** [{ label, description, onSelect }] — the real ways to a first record. */
  routes = [],
  /** Say the description on a nothing-yet state too. People's lists do (plan 8 Nov 2026, §3 rule 4: one sentence on
      what the screen is for and one action); Accounting's keep the heading alone, as decided before. */
  describe = false,
}) => {
  const isFiltered = kind === 'filtered';
  const isDisabled = kind === 'disabled';

  const headline =
    title ||
    (isFiltered ? 'Nothing matches these filters' : isDisabled ? 'This is switched off' : 'Nothing added yet');

  const body =
    description ||
    (isFiltered && totalCount
      ? `All ${totalCount} are still here. The filters below are narrowing them to nothing.`
      : null);

  return (
    <div className="ui-in ui-empty-state flex flex-col items-center justify-center text-center py-8 px-6">
      {/*
        An illustration rather than an icon in a grey circle.

        Blank screens are the whole first hour of a new company, and until now
        they were a 20px glyph and two lines of text — the least considered
        surface in the product, on the day a user decides what they think of it.

        The art is keyed off `kind`, which every call site already passes, so
        all fifty-two of them gained this without being edited.

        The `icon` prop is deliberately ignored here now. My first pass let an
        icon win when one was given, and then measurement showed every single
        one of the fifty-two call sites passes an icon — so the illustration
        would have rendered nowhere and shipped dead. The icons were module
        glyphs standing in for art that did not exist; the art exists now.
        The prop stays in the signature so no caller breaks.
      */}
      <Illustration kind={kind} size={64} className="ui-empty-art mb-3 opacity-90" />

      <div className="ui-t-sec ui-empty-head">{headline}</div>
      {/*
        The sentence under "No customers yet" is gone.

        On a nothing-yet state it restated the heading and then explained what
        a customer is to somebody already inside an accounting product — two
        lines of page on every empty list in the app. A filtered state keeps
        its line, because there the sentence is the whole point: it says the
        records exist and the filters are hiding them, which the heading
        cannot say on its own.
      */}
      {body && (isFiltered || describe) ? <div className="ui-muted ui-t-body mt-1 max-w-md">{body}</div> : null}

      {isFiltered && filters.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5 justify-center">
          {filters.map((f) => (
            <span
              key={`${f.label}-${f.value}`}
              className="ui-sunken border ui-border-c rounded-full text-xs px-2.5 py-1 inline-flex items-center gap-1.5"
            >
              <span className="ui-muted">{f.label}</span>
              <span>{f.value}</span>
              {typeof f.onRemove === 'function' ? (
                <button
                  type="button"
                  onClick={f.onRemove}
                  className="ui-subtle hover:ui-fg"
                  aria-label={`Remove the ${f.label} filter`}
                >
                  {inBooks() ? '×' : <X size={12} aria-hidden="true" />}
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {isFiltered && typeof onClearFilters === 'function' ? (
        <button type="button" onClick={onClearFilters} className="ui-btn ui-btn-secondary ui-btn-sm mt-3">
          Clear filters
        </button>
      ) : null}

      {!isFiltered && routes.length ? (
        /*
          Centred on the cards, not on a three-column grid.

          This was `sm:grid-cols-3`, so two routes — which is most of them —
          filled columns one and two and left the third empty. The cards then
          sat left of the heading and the sentence above them, which are
          centred. A row that centres whatever it is given keeps the block
          symmetrical at one, two or three routes.
        */
        routes.length === 1 ? (
          /*
            One route is an action, not a choice.

            A card is how you offer a decision between two or three ways in.
            Offered alone it read as a bordered box someone forgot to fill —
            the same shape as the empty state around it — where every other
            blank screen in the product puts the button you came to press.
          */
          <div className="mt-4 flex flex-col items-center gap-2">
            {/* Secondary, not primary: the screen's one primary is top right (DESIGN.md, Component Contract rule 1;
                People plan 8 Nov 2026, step 3). The empty state repeats the way in, it does not compete with it. */}
            <button type="button" onClick={routes[0].onSelect} className="ui-btn ui-btn-secondary">
              {routes[0].label}
            </button>
            {routes[0].description ? (
              <span className="ui-muted text-xs max-w-xs leading-4">{routes[0].description}</span>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 flex w-full max-w-2xl flex-col flex-wrap justify-center gap-2 text-left sm:flex-row">
            {routes.map((r) => (
              <button
                key={r.label}
                type="button"
                onClick={r.onSelect}
                className="ui-card p-3 whitespace-normal hover:border-[rgb(var(--brand))] transition-colors sm:w-[13.5rem]"
              >
                <span className="block text-sm font-semibold">{r.label}</span>
                {r.description ? <span className="block ui-muted text-xs mt-0.5 leading-4">{r.description}</span> : null}
              </button>
            ))}
          </div>
        )
      ) : null}

      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
};

/* --- loading placeholders -------------------------------------------------
   Every skeleton mirrors the shape of the thing it stands in for, so the
   layout does not jump when real data lands. They are hidden from assistive
   technology and announced once through a live region instead: a screen
   reader hearing twenty shimmering boxes learns nothing.
--------------------------------------------------------------------------- */

/**
 * Owner's pick (17 Nov 2026, round 5): while something loads, a spinner with "Loading…", not grey
 * shapes. Books keeps its grey shapes.
 */
export const loadsWithSpinner = () => typeof document === 'undefined' || document.documentElement.dataset.palette !== 'indigo';
export const LoadingSpinner = ({ label = 'Loading…' }) => (
  <span className="ui-loading"><span className="ui-spinner" aria-hidden="true" />{label}</span>
);

/** Skeleton row for tables — reserves height so loading does not shift layout. */
export const SkeletonRows = ({ rows = 5, cols = 4 }) => (loadsWithSpinner() ? (
  /* The spinner sits in the height the rows will take (44px each), so the page does not jump when they land. */
  <tr aria-hidden="true"><td colSpan={cols} className="ui-loading-cell" style={{ height: `${rows * 2.75}rem` }}><LoadingSpinner /></td></tr>
) : (
  <>
    {Array.from({ length: rows }).map((_, r) => (
      <tr key={r} aria-hidden="true">
        {Array.from({ length: cols }).map((__, c) => (
          <td key={c} className="ui-col-meta px-3 py-2">
            <div className="ui-skel ui-skel-text" style={{ width: c === 0 ? '60%' : '80%' }} />
          </td>
        ))}
      </tr>
    ))}
  </>
));

/**
 * Drop-in replacement for a centred "Loading…" line above a table: rows the
 * shape of the data, announced once through the live region. Layout does not
 * jump when the real rows land.
 */
export const TableSkeleton = ({ rows = 6, cols = 4 }) => (
  <LoadingRegion>
    <table className="ui-table w-full" aria-hidden="true">
      <tbody>
        <SkeletonRows rows={rows} cols={cols} />
      </tbody>
    </table>
  </LoadingRegion>
);

/** Placeholder for a metric tile, matching StatTile's height exactly. */
export const SkeletonStats = ({ count = 4 }) => (loadsWithSpinner() ? <div className="ui-loading-block" aria-hidden="true" style={{ minHeight: '6.5rem' }}><LoadingSpinner /></div> : (
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="ui-card p-4">
        <div className="ui-skel ui-skel-text" style={{ width: '45%' }} />
        <div className="ui-skel ui-skel-amount mt-3" />
        <div className="ui-skel ui-skel-text mt-2" style={{ width: '30%' }} />
      </div>
    ))}
  </div>
));

/** Placeholder for a card of prose or form fields. */
export const SkeletonCard = ({ lines = 3 }) => (loadsWithSpinner() ? <div className="ui-loading-block" aria-hidden="true" style={{ minHeight: `${lines * 1.25 + 4}rem`, alignItems: 'center' }}><LoadingSpinner /></div> : (
  <div className="ui-card p-4" aria-hidden="true">
    <div className="ui-skel ui-skel-title" />
    <div className="mt-4 space-y-2.5">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="ui-skel ui-skel-text"
          style={{ width: i === lines - 1 ? '65%' : '100%' }}
        />
      ))}
    </div>
  </div>
));

/**
 * Wraps a loading region so the wait is announced once, politely, instead of
 * leaving a screen reader in silence while the page fills in.
 */
export const LoadingRegion = ({ label = 'Loading', children }) => (
  <div role="status" aria-live="polite" aria-busy="true">
    <span className="sr-only">{label}</span>
    {children}
  </div>
);

/** Inline busy indicator (not for buttons: a button uses <Button loading>). */
export const Spinner = () => <span className="ui-spinner" aria-hidden="true" />;

/**
 * A `.ui-btn` with the shared loading and done states (DESIGN.md, Buttons).
 *
 * `loading`: aria-busy, a spinner in the icon's place (or over the label when
 * there is no icon), clicks and a second submit refused, width and label kept.
 * Not `disabled`: nothing is wrong, the request is on its way.
 * `done`: a tick and `doneLabel` for a moment, from useDoneFlash. Sparingly;
 * the toast is the main success signal.
 * `icon`: a component, drawn at 16px (14px on `size="sm"`), aria-hidden.
 */
const buttonClasses = cva('ui-btn', {
  variants: {
    variant: { primary: 'ui-btn-primary', secondary: 'ui-btn-secondary', ghost: 'ui-btn-ghost', danger: 'ui-btn-danger' },
    size: { sm: 'ui-btn-sm' },
  },
});
export const Button = ({
  variant = 'secondary', size, icon: Icon = null, loading: busy = false, done, doneLabel = 'Saved',
  className = '', type = 'button', onClick, children, plain = false, ...rest
}) => {
  // A busy flag is often the id of the row being saved, so it is read as yes or no.
  const loading = Boolean(busy);
  const state = loading ? 'loading' : done ? 'done' : undefined;
  const guard = (e) => {
    if (loading) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onClick?.(e);
  };
  // plain: the caller's own button classes (the Admin center and Ops ws-btn), with the same states.
  const cls = plain ? className : buttonClasses({ variant, size, className });
  return (
    <>
      <button type={type} className={cls} aria-busy={loading || undefined} aria-disabled={loading || undefined} data-state={state} onClick={guard} {...rest}>
        {Icon ? (
          <span className="ui-btn-icon" aria-hidden="true">
            {loading ? <span className="ui-btn-spinner" /> : done ? <Check size={16} /> : <Icon size={16} />}
          </span>
        ) : null}
        <span className="ui-btn-label">
          <span className="ui-btn-text" aria-hidden={done ? 'true' : undefined}>{children}</span>
          <span className="ui-btn-done" aria-hidden={done ? undefined : 'true'}>{Icon ? null : <Check size={14} aria-hidden="true" />}{doneLabel}</span>
          {Icon ? null : <span className="ui-btn-spinner" aria-hidden="true" />}
        </span>
      </button>
      {/* Mounted empty from the start: a live region that appears already holding its words is often not read out.
          Only a button that has a done state (done passed, even false) needs one. */}
      {done === undefined ? null : <span className="sr-only" role="status">{done ? doneLabel : ''}</span>}
    </>
  );
};

/** The done state's clock: `flash()` after a save shows it for `ms`, then it goes. */
export const useDoneFlash = (ms = 1500) => {
  const [done, setDone] = React.useState(false);
  const timer = React.useRef(0);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const flash = React.useCallback(() => {
    clearTimeout(timer.current);
    setDone(true);
    timer.current = setTimeout(() => setDone(false), ms);
  }, [ms]);
  return [done, flash];
};

/** Small inline confirmation used after save actions. */
export const SavedHint = ({ show, label = 'Saved' }) =>
  show ? (
    <span className="ui-pill ui-pill-pos" role="status">
      <Check size={11} aria-hidden="true" />
      {label}
    </span>
  ) : null;

/**
 * What the rows on screen come to.
 *
 * Every list in this product is a list of money, and the question a person
 * arrives with is almost never "which row" — it is "what does this lot come
 * to". Without this the answer lives in a spreadsheet: filter here, export,
 * sum a column there, come back.
 *
 * `count` is what is showing and `totalCount` is what exists, so a filtered
 * view says so plainly rather than presenting a partial sum as the whole.
 * Figures must be computed over the filtered set — not over the rendered rows —
 * or the day this list gets a page window the number quietly becomes a lie.
 */
/**
 * "1 invoices" is the kind of thing that makes a product look unfinished.
 *
 * Covers the twenty-two nouns the lists actually use: plain +s ("invoices"),
 * -ies ("entries", "categories", "parties"), the -es that follows a sibilant
 * ("batches"), and the one irregular in the set — "salesmen", which has no
 * trailing s at all and would otherwise come through untouched.
 *
 * Anything this would get wrong takes `nounOne` instead of a longer rule.
 */
const IRREGULAR_SINGULARS = { salesmen: 'salesman', men: 'man', people: 'person', children: 'child' };

export const singularise = (noun) => {
  const s = String(noun || '');
  const hit = IRREGULAR_SINGULARS[s.toLowerCase()];
  if (hit) return hit;
  if (/ies$/i.test(s)) return `${s.slice(0, -3)}y`;
  if (/(ch|sh|s|x|z)es$/i.test(s)) return s.slice(0, -2);
  return s.replace(/s$/i, '');
};

/* Totals belong in the summary cards and amount columns. A second strip below
   the grid keeps the horizontal scrollbar away from the bottom of the page. */
export const TableTotals = () => null;

/**
 * The message that belongs under the box it is about.
 *
 * Renders nothing when there is no error, so it can sit in the markup
 * permanently without reserving space or needing a conditional around it.
 *
 * Not a live region of its own: five fields failing at once read as five
 * interruptions. The summary (or the form's one error line) announces; the
 * field carries the words through aria-describedby, and the cursor lands on
 * the first wrong field, which reads them out.
 */
export const FieldError = ({ error, id }) =>
  error ? (
    <p id={id} className="ui-field-error">
      {error}
    </p>
  ) : null;

/**
 * The one announcement for a form whose fields failed, for a screen reader.
 *
 * The words are already under each field; this reads them out once, together,
 * instead of every FieldError interrupting on its own. Nothing is drawn.
 */
export const FieldErrorAnnounce = ({ errors = {} }) => {
  const messages = Object.values(errors).filter(Boolean);
  if (!messages.length) return null;
  return (
    <p role="alert" className="sr-only">
      {`${messages.length} field${messages.length === 1 ? '' : 's'} need${messages.length === 1 ? 's' : ''} attention: ${messages.join(' ')}`}
    </p>
  );
};

/**
 * A count of what is wrong, next to the button that is refusing to proceed.
 *
 * Individual messages live at their fields; this exists because on a long form
 * the failing field can be off screen, and "nothing happened when I pressed
 * Save" is the worst possible feedback.
 */
export const FieldErrorSummary = ({ errors = {} }) => {
  const n = Object.keys(errors).length;
  if (!n) return null;
  return (
    <span className="ui-field-error" role="status">
      {n} field{n === 1 ? '' : 's'} need{n === 1 ? 's' : ''} attention
    </span>
  );
};
