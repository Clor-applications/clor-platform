import { createElement, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Lock } from 'lucide-react';
import { fieldIconFor } from '../ui/entityIdentity';
import { useFeatures } from '../../permissions/useFeatures';

import Popover from '../ui/Popover';
import { rankedSearch } from '../../utils/rankedSearch';
import { useListboxKeys, openOnKey } from './useListboxKeys';

const normalizeText = (v) => String(v || '').trim().toLowerCase();

/** Below this many options there is nothing to search — the list is the search. */
const SEARCH_THRESHOLD = 8;

/**
 * Pick one value from a list.
 *
 * This used to open a full dialog: scrim, trapped keyboard, the page dimmed —
 * the same ceremony for choosing between three warehouses as for filling in a
 * user record. It now opens an anchored panel instead, so the form you are
 * filling stays lit and readable behind the choice you are making. Arrow keys
 * and Enter work, because on a form this size the hands should not have to
 * leave the keyboard to answer a question this small.
 */
const PopupSelect = ({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select',
  disabled = false,
  /* For a picker inside a table, where the column header is the only label
     and no <label> element can point at the trigger. */
  ariaLabel = '',
  allowCustom = false,
  alwaysSearch = false,
  customActionText = 'Use',
  onCustomAction,
  actionText = '',
  onAction,
  showValueSubtext = true,
  title,
  /* A lucide component drawn inside the control, before the value — the
     field says what it is about without being read. Decorative: the label
     and the aria-label already name the control. */
  icon: LeadingIcon = undefined,
  // `maxWidthClass` sized the old dialog. Call sites still pass it; the panel
  // takes its width from the control it hangs off, so it is swallowed here
  // rather than made every caller's problem to remove.
  ...ignoredLegacyProps
}) => {
  void ignoredLegacyProps;
  const { isEnabled } = useFeatures();
  const featureLocked = String(title || '').trim().toLowerCase() === 'branches' && !isEnabled('branches');
  const controlDisabled = disabled || featureLocked;
  /* The caller's icon wins; otherwise the label decides. An explicit `null`
     is a caller saying "no mark on this one" and is left alone. */
  /* A picker inside a grid row prints its name in the column heading, not in
     a label of its own, and names itself to a screen reader instead — so the
     spoken name is what says what it picks. "Ledger, line 1" resolves the same
     mark as a field labelled "Ledger". */
  const leading = LeadingIcon === undefined ? fieldIconFor(label || ariaLabel) : LeadingIcon;
  const [open, setOpen] = useState(false);
  // Stable per instance: several of these sit on one form.
  const listId = useId();
  const [query, setQuery] = useState('');
  const triggerRef = useRef(null);
  const searchRef = useRef(null);

  const normalizedQuery = normalizeText(query);

  /*
   * Ranked by the same rule as every other list: exact, starts-with, a word
   * inside the label, then the code, then anything containing it. A ledger
   * code is typed rather than read, so it is matched as a code and outranks a
   * stray substring in some other account's name.
   */
  const filtered = useMemo(() => {
    if (!normalizedQuery) return options || [];
    return rankedSearch(options || [], normalizedQuery, {
      /* `searchText` is the plain name where the label carries a tree indent —
         typing "TDS" must find a group however deep it sits. */
      fields: (o) => [o?.searchText, o?.label, o?.value],
      codes: (o) => [o?.code],
    });
  }, [normalizedQuery, options]);

  const showSearch = alwaysSearch || (options || []).length >= SEARCH_THRESHOLD;

  const normalizedValue = String(value || '').trim();
  const displayLabel = useMemo(() => {
    if (!normalizedValue) return '';
    const exact = (options || []).find((o) => String(o.value || '').trim() === normalizedValue);
    if (!exact) return normalizedValue;
    const labelText = String(exact.searchText || exact.label || exact.value || '');
    const codeText = String(exact.code || '').trim();
    return codeText ? `${codeText} - ${labelText}` : labelText;
  }, [normalizedValue, options]);

  /* A disabled branch feature still has one bookkeeping branch. Select its
     default once and keep the control visible as context, without asking the
     operator to make a branch decision. */
  useEffect(() => {
    if (!featureLocked || normalizedValue) return;
    const fallback = (options || []).find((option) => String(option?.value || '').trim());
    if (fallback) onChange?.(String(fallback.value));
  }, [featureLocked, normalizedValue, onChange, options]);

  const openPopup = () => {
    if (controlDisabled) return;
    setQuery('');
    // Open on what is already chosen, so Enter without touching anything is a
    // no-op rather than a silent change to the first row.
    const at = (options || []).findIndex((o) => String(o.value || '').trim() === normalizedValue);
    setActiveIndex(at >= 0 ? at : 0);
    setOpen((prev) => !prev);
  };

  const closePopup = ({ advance = false } = {}) => {
    setOpen(false);
    setQuery('');
    /*
     * The caret stays on the trigger, which is where it already is — this
     * panel never took it. Moving on is Tab's job and the browser's, not
     * ours: hand-computing the next control gave a second, worse copy of the
     * page's tab order, and when the two disagreed Tab looked like it skipped
     * the warehouse field. `advance` is now only about not stealing focus
     * back on a mouse pick.
     */
    if (!advance) requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };

  const applyValue = (next) => {
    const nextValue = String(next || '').trim();
    onChange?.(nextValue);
    closePopup({ advance: true });
  };

  const runCustomAction = (next) => {
    const nextValue = String(next || '').trim();
    if (!nextValue) return;
    if (typeof onCustomAction === 'function') {
      closePopup({ advance: true });
      onCustomAction(nextValue);
      return;
    }
    applyValue(nextValue);
  };

  const canUseCustom = allowCustom && String(query || '').trim();
  const customValue = String(query || '').trim();
  const customIsAlreadyOption = (options || []).some((o) => String(o?.value || '').trim().toLowerCase() === customValue.toLowerCase());

  useEffect(() => {
    if (!open || !showSearch) return;
    searchRef.current?.focus();
  }, [open, showSearch]);

  /*
   * The shared keyboard contract, so this behaves exactly like the customer,
   * vendor and item lists: arrows wrap, Home/End jump, PageUp/Down move ten,
   * Enter takes the highlight, Escape leaves without changing anything.
   *
   * Enter on an empty result falls through to the create-this action when the
   * caller allows one — otherwise typing a new value and pressing Enter would
   * silently do nothing.
   */
  const {
    activeIndex,
    setActiveIndex,
    listRef,
    onKeyDown: onListKeys,
  } = useListboxKeys({
    count: filtered.length,
    onChoose: (i) => {
      const picked = filtered[i];
      if (picked) applyValue(picked.value);
    },
    nativeTab: true,
    onCancel: () => closePopup(),
    // Tab off a list nobody drove: leave the value alone and carry on,
    // rather than snapping back to the field just left.
    onTabOut: () => closePopup({ advance: true }),
    // Only where there is no search box to take the keystroke.
    firstLetter: showSearch ? null : (i) => filtered[i]?.label,
  });

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !filtered.length && canUseCustom && !customIsAlreadyOption) {
      e.preventDefault();
      runCustomAction(customValue);
      return;
    }
    onListKeys(e);
  };

  /*
   * The trigger keeps the caret for as long as the list is open, and every key
   * is answered from here.
   *
   * Focus used to be pushed into the portalled panel, which meant the trigger,
   * the panel's own focus claim, the panel's hand-back on close and the
   * caller's move to the next field were all trying to place the cursor. The
   * order varied, so the arrows moved nothing, Tab was answered by the form
   * behind, and Enter worked only when the race happened to fall the right
   * way. One element owns the keyboard now, so there is nothing to race.
   *
   * A panel with a search box is the exception: the caret has to be in the box
   * to type, and an input is a real focus target, so those keep the old route.
   */
  const onTriggerKeyDown = (e) => {
    if (!open) {
      openOnKey(() => openPopup())(e);
      return;
    }
    if (showSearch) return;
    onKeyDown(e);
  };

  const activeOptionId = open && filtered[activeIndex] ? `${listId}-opt-${activeIndex}` : undefined;

  return (
    <>
      {label ? <label className="ui-label">{label}</label> : null}
      <button
        ref={triggerRef}
        type="button"
        onClick={openPopup}
        onKeyDown={onTriggerKeyDown}
        onBlur={(e) => {
          // The caret leaving the trigger ends the list, unless it went into
          // the panel itself (a search box, or an option taking a click).
          if (!open) return;
          const next = e.relatedTarget;
          if (!next) return;
          if (next.closest?.('[role="dialog"]')) return;
          setOpen(false);
        }}
        disabled={controlDisabled}
        role="combobox"
        /* The visible label is a plain <label> with nothing to point at — a
           button is not a form control it can be `for`. Without this the
           control announces only whatever is currently selected. */
        aria-label={ariaLabel || (typeof label === 'string' && label ? label : undefined)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeOptionId}
        /*
          The same metrics as a text field, because it stands in a row with
          them. On its own padding and inherited 16px type it was two pixels
          taller and a size bigger than the City box beside it, which is what
          made a row of four controls look like two pairs.
        */
        className={`ui-input flex items-center justify-between gap-2 text-left ${
          controlDisabled ? 'ui-sunken ui-muted cursor-not-allowed' : 'ui-hover-sunken'
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {/* createElement: a capitalised local reads to the linter as a
              component declared in a render. It is a lookup. */}
          {featureLocked ? <Lock size={14} className="ui-muted shrink-0" aria-hidden="true" /> : leading ? createElement(leading, { size: 16, className: 'ui-subtle shrink-0', 'aria-hidden': 'true' }) : null}
          <span className={`truncate ${displayLabel ? 'ui-fg' : 'ui-subtle'}`}>{displayLabel || placeholder}</span>
        </span>
        <ChevronDown size={16} className="ui-muted shrink-0" />
      </button>

      {open && (
        <Popover anchorRef={triggerRef} onClose={() => closePopup()} onKeyDown={onKeyDown} autoFocus={showSearch}>
          {showSearch ? (
            <div className="p-2 border-b">
              <input
                ref={searchRef}
                // Claimed by Popover once the panel is placed; focusing from
                // the effect below alone is too early to stick.
                data-autofocus="true"
                type="text"
                value={query}
                onChange={(e) => {
                  // Typing narrows the list, so whatever was highlighted may
                  // no longer be in it.
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                className="ui-input w-full px-2.5 py-1.5"
                placeholder={`Search ${String(title || label || '').toLowerCase() || 'options'}…`}
              />
            </div>
          ) : null}

          {actionText && typeof onAction === 'function' ? (
            <button
              type="button"
              onClick={() => {
                closePopup({ advance: true });
                onAction();
              }}
              className="w-full border-b px-3 py-2.5 text-left text-sm font-semibold ui-hover-sunken"
              style={{ color: 'rgb(var(--brand))' }}
            >
              {actionText}
            </button>
          ) : null}

          {canUseCustom && !customIsAlreadyOption ? (
            <button
              type="button"
              onClick={() => runCustomAction(customValue)}
              className="w-full px-3 py-2 text-left ui-hover-sunken border-b text-sm"
            >
              {String(customActionText || 'Use').trim() || 'Use'} “{customValue}”
            </button>
          ) : null}

          <div
            ref={listRef}
            role="listbox"
            /*
             * Focusable, and the panel's default claim when no search box is
             * rendered. Below the search threshold nothing inside the panel
             * could take focus at all, so the keyboard stayed on the trigger
             * behind it and the arrow keys had nothing to move.
             */
            id={listId}
            tabIndex={-1}
            className="overflow-y-auto divide-y outline-none"
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm ui-muted">No results</div>
            ) : (
              filtered.map((o, i) => (
                <button
                  key={`${String(o.value)}-${String(o.label)}`}
                  id={`${listId}-opt-${i}`}
                  type="button"
                  // Not a tab stop: the trigger holds the caret and points here
                  // with aria-activedescendant.
                  tabIndex={-1}
                  role="option"
                  aria-selected={String(o.value || '').trim() === normalizedValue}
                  data-active={i === activeIndex}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => applyValue(o.value)}
                  className={`w-full px-3 py-2 text-left text-sm ${i === activeIndex ? '' : 'ui-hover-sunken'}`}
                  /* Filled, not a faint wash. The cursor row was `ui-sunken`
                     alone, which on a white panel is close enough to nothing
                     that pressing the down arrow looked like a dead key. */
                  /* A light tint with a brand edge, not a solid orange bar.
                     Filled, the highlighted row was the loudest thing on the
                     screen and turned a list into a row of warning labels; the
                     tint alone was what earlier read as a dead key, so the edge
                     carries the state instead. */
                  style={
                    i === activeIndex
                      ? {
                          backgroundColor: 'rgb(var(--brand) / 0.12)',
                          color: 'rgb(var(--brand-ink))',
                          boxShadow: 'inset 3px 0 0 rgb(var(--brand))',
                        }
                      : undefined
                  }
                >
                  {String(o.code || '').trim() ? (
                    <div className="grid grid-cols-[72px_1fr] gap-2 items-center">
                      <div className={`text-xs ${i === activeIndex ? 'opacity-80' : 'ui-muted'}`}>{String(o.code || '').trim()}</div>
                      <div className={`font-medium ${i === activeIndex ? '' : 'ui-fg'}`}>{o.label}</div>
                    </div>
                  ) : (
                    <div className={`font-medium ${i === activeIndex ? '' : 'ui-fg'}`}>{o.label}</div>
                  )}
                  {showValueSubtext && String(o.value || '').trim() !== String(o.label || '').trim() ? (
                    <div className={`text-xs ${i === activeIndex ? 'opacity-80' : 'ui-muted'}`}>{o.value}</div>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </Popover>
      )}
    </>
  );
};

export default PopupSelect;
