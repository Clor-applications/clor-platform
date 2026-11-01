import React, { Suspense, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';

import Drawer from '@ui/components/ui/Drawer';
import Popover from '@ui/components/ui/Popover';

import { ledgerForms } from './ledgerFormRegistry';

import { rankedSearch, soleConfidentMatch } from '@ui/utils/rankedSearch';
import { useListboxKeys, openOnKey, focusNextAfter } from '@ui/components/pickers/useListboxKeys';
import { useRecentPicks } from '@ui/components/pickers/useRecentPicks';

const safeArray = (v) => (Array.isArray(v) ? v : []);

/*
 * The masters' own ledger form, handed over by the app rather than reached for.
 *
 * This was `lazy(() => import('../../App'))`, which closed a circle — App
 * imports this field, this field imports App — and a circle means neither can
 * be rendered or tested without the whole of the other. Loading it late does
 * not stop it being a cycle. See ledgerFormRegistry.js.
 */

/**
 * A ledger, typed rather than hunted for.
 *
 * The allocation row used to be a `<select>` holding every ledger in the book,
 * alphabetically. On a company of any age that is a scroll through a hundred
 * names to find the one you already knew, and there is no way at all to post
 * to a ledger that does not exist yet — you leave the receipt, make the
 * ledger, and come back to start again.
 *
 * So it is the field the line grid already uses for items: type, see what
 * matches, and if nothing does, make it from here. The old `AccountPicker` was
 * the same idea, but it was a button that opened a dialog that held a search
 * box — two clicks before the first keystroke, which is one more than a row in
 * a table can afford.
 */
export const LedgerField = ({
  db,
  setDb,
  currentCompany,
  value,
  onChange,
  options = null,
  placeholder = 'Type a ledger name or code',
  ariaLabel = 'Ledger',
  disabled = false,
  canCreate = true,
  creationGroupCategory = '',
  /* The masters' own modal host, so a group can be created from inside the
     ledger form the way it can on the Chart of Accounts screen. */
  openModal = null,
}) => {
  const ledgers = useMemo(() => {
    /*
     * A list the caller supplied is the caller's answer, not a starting point.
     *
     * This filtered every source by `companyId`, including one passed in — and
     * a caller that has already chosen the right ledgers passes what the field
     * needs to show them, which is an id and a name. The receipt and payment
     * screens do exactly that, so every option failed
     * `Number(undefined) === companyId` and the allocation picker offered
     * nothing but "Create a new ledger" against a book with forty-five
     * ledgers in it.
     *
     * So the company filter belongs only to the list this field goes and finds
     * for itself. What the caller passes is shown, minus anything it has
     * marked inactive or hidden.
     */
    const given = Array.isArray(options);
    const source = given ? options : safeArray(db?.chartOfAccounts);
    return source
      .filter(
        (a) =>
          (given || Number(a?.companyId) === Number(currentCompany?.id)) &&
          a?.isActive !== false &&
          !a?.hiddenFromChart
      )
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [options, db?.chartOfAccounts, currentCompany?.id]);

  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('select');

  /*
   * Whatever the app registered.
   *
   * Whether this field offers to create is the caller's decision, through
   * `canCreate` — not a consequence of which modules happen to have loaded. It
   * was briefly the latter, and the button then vanished anywhere the registry
   * had not been filled, including in this field's own tests.
   */
  const [search, setSearch] = useState('');

  const selected = value ? ledgers.find((a) => String(a.id) === String(value)) : null;
  const selectedName = selected ? selected.name : '';

  const typed = String(search || '').trim();
  const recents = useRecentPicks('ledger', currentCompany?.id);

  /* A code is typed, not read, so a code hit outranks the same string buried
     in another ledger's name. Unfiltered, the ones this operator actually
     posts to come first. */
  const searchOpts = {
    fields: (a) => [a.name, a.groupName, a.ledgerCategory],
    codes: (a) => [a.code],
  };
  const filtered = typed ? rankedSearch(ledgers, typed.toLowerCase(), searchOpts) : recents.promote(ledgers);
  const recentCount = typed ? 0 : recents.recentCount(filtered);

  const close = ({ advance = false, refocus = true } = {}) => {
    setOpen(false);
    setMode('select');
    setSearch('');
    requestAnimationFrame(() => {
      if (advance) focusNextAfter(triggerRef.current);
      else if (refocus) triggerRef.current?.focus({ preventScroll: true });
    });
  };

  const choose = (ledger) => {
    if (!ledger) return;
    recents.remember(ledger.id);
    onChange?.(String(ledger.id));
    close({ advance: true });
  };

  const openPopup = () => {
    setMode('select');
    setSearch('');
    setOpen(true);
  };

  /* Tab out of the field takes the one match, when there is exactly one — a
     full code should not have to be confirmed, and a partial one should not
     be guessed at. */
  const onTab = (e) => {
    if (e.key !== 'Tab' || e.shiftKey) return;
    const sole = soleConfidentMatch(ledgers, search, searchOpts);
    if (!sole) return;
    e.preventDefault();
    e.stopPropagation();
    choose(sole);
  };

  const { activeIndex, setActiveIndex, listRef, onKeyDown } = useListboxKeys({
    count: filtered.length,
    onChoose: (i) => choose(filtered[i]),
    onCancel: () => close(),
    onTabOut: () => close({ advance: true }),
  });

  return (
    <>
      <input
        ref={triggerRef}
        type="text"
        role="combobox"
        value={open ? search : selectedName}
        placeholder={placeholder}
        disabled={disabled}
        onMouseDown={() => {
          /* A click or a keystroke opens it — never focus alone, which arrives
             as the list closes and would reopen it on the same gesture. */
          if (open) return;
          setSearch('');
          setMode('select');
          setOpen(true);
        }}
        onChange={(e) => {
          if (!open) {
            setMode('select');
            setOpen(true);
          }
          setSearch(e.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={(e) => {
          if (!open) {
            openOnKey(openPopup)(e);
            return;
          }
          /* Alt+C makes the ledger that is not on file, without leaving the
             row — the same reflex the item field answers to. */
          if (e.altKey && (e.key === 'c' || e.key === 'C')) {
            e.preventDefault();
            e.stopPropagation();
            if (canCreate) setMode('create');
            return;
          }
          onTab(e);
          onKeyDown(e);
        }}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[activeIndex] ? `ledger-opt-${filtered[activeIndex].id}` : undefined}
        className="ui-input w-full"
      />

      {open && mode === 'select' ? (
        <Popover anchorRef={triggerRef} onClose={() => close({ refocus: false })} autoFocus={false} minWidth={320}>
          <div ref={listRef} role="listbox" className="max-h-80 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm ui-muted">
                {typed ? `No ledger matches “${typed}”.` : 'No ledgers yet.'}
              </div>
            ) : (
              filtered.map((a, n) => {
                const on = n === activeIndex;
                return (
                  <React.Fragment key={a.id}>
                    {recentCount && n === 0 ? (
                      <div className="ui-caption px-2 pt-1 pb-0.5">Recently used</div>
                    ) : null}
                    {recentCount && n === recentCount ? (
                      <div className="ui-caption px-2 pt-2 pb-0.5">All ledgers</div>
                    ) : null}
                    <button
                      id={`ledger-opt-${a.id}`}
                      type="button"
                      role="option"
                      aria-selected={String(a.id) === String(value)}
                      data-active={on || undefined}
                      onMouseEnter={() => setActiveIndex(n)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(a)}
                      className={`w-full rounded-lg px-3 py-2 text-left ${on ? '' : 'ui-hover-sunken'}`}
                      style={on ? { backgroundColor: 'rgb(var(--brand))', color: 'rgb(var(--on-brand))' } : undefined}
                    >
                      <div className={`text-sm font-medium ${on ? '' : 'ui-fg'}`}>{a.name}</div>
                      {a.code || a.groupName ? (
                        <div className={`text-xs truncate ${on ? 'opacity-80' : 'ui-muted'}`}>
                          {[a.code, a.groupName].filter(Boolean).join(' • ')}
                        </div>
                      ) : null}
                    </button>
                  </React.Fragment>
                );
              })
            )}
          </div>

          {canCreate ? (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setMode('create')}
              className="ui-hover-sunken flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm"
            >
              <Plus size={14} aria-hidden="true" />
              {typed ? `Create “${typed}”` : 'Create a new ledger'}
            </button>
          ) : null}
        </Popover>
      ) : null}

      {open && mode === 'create' ? (
        /*
         * The Chart of Accounts form itself, not a second one.
         *
         * There are two ledger forms in this codebase — this is the one the
         * master screen opens, so a ledger made from a receipt is made by the
         * same code, with the same groups and the same validation, as one made
         * from Master Data. The shared drawer keeps the entry visible behind it.
         */
        <Drawer open onClose={() => close()} title="New Ledger" widthClass="ui-form-drawer">
          <Suspense fallback={<div className="ui-skel rounded-xl" style={{ height: 320 }} aria-hidden="true" />}>
          {/* Said out loud rather than shown as an empty dialog: a missing
              registration is a wiring mistake, and a blank modal hides it. */}
          {!ledgerForms.ChartAccountForm ? (
            <p className="ui-muted p-6 text-sm">
              The ledger form is not available on this screen. Make the ledger from Master Data.
            </p>
          ) : (
          <ledgerForms.ChartAccountForm
            db={db}
            setDb={setDb}
            currentCompany={currentCompany}
            openModal={openModal}
            /* What was typed is the name. Retyping it into the form the search
               just failed to match is the whole point of this route. */
            initialName={typed}
            includeGroupIds={
              creationGroupCategory
                ? safeArray(db?.accountGroups)
                    .filter((group) =>
                      Number(group?.companyId) === Number(currentCompany?.id) &&
                      String(group?.groupCategory || '').trim() === String(creationGroupCategory).trim()
                    )
                    .map((group) => group.id)
                : null
            }
            onCreated={(account) => {
              if (account?.id) {
                recents.remember(account.id);
                onChange?.(String(account.id));
              }
              close({ advance: true });
            }}
            onClose={() => setMode('select')}
          />
          )}
          </Suspense>
        </Drawer>
      ) : null}
    </>
  );
};

export default LedgerField;
