import React from 'react';
import { useMemo, useRef, useState } from 'react';
import { notify } from '@ui/components/ui/notify';

import Modal from '@ui/components/ui/Modal';
import Drawer from '@ui/components/ui/Drawer';
import { CustomerForm } from './CustomerPicker';
import { VendorForm } from './VendorPicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { rankedSearch, soleConfidentMatch } from '@ui/utils/rankedSearch';
import { useListboxKeys, openOnKey, focusNextAfter } from '@ui/components/pickers/useListboxKeys';
import { useRecentPicks } from '@ui/components/pickers/useRecentPicks';

const safeArray = (v) => (Array.isArray(v) ? v : []);

export const AccountForm = ({ db, setDb, currentCompany, initialData = null, excludeGroupCategories = [], onCreated, onClose }) => {
  const isEdit = Boolean(initialData && initialData.id);
  const selectedGroupId = isEdit && initialData?.groupId ? String(initialData.groupId) : '';

  const excludedCats = new Set((Array.isArray(excludeGroupCategories) ? excludeGroupCategories : []).map((x) => String(x || '').trim()));

  const groups = useMemo(() => {
    return safeArray(db.accountGroups)
      .filter((g) => g.companyId === currentCompany.id)
      .filter((g) => !g.isLegacy || (selectedGroupId && String(g.id) === selectedGroupId))
      .filter((g) => !excludedCats.has(String(g.groupCategory || '').trim()) || (selectedGroupId && String(g.id) === selectedGroupId))
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [db.accountGroups, currentCompany.id, selectedGroupId, excludeGroupCategories]);

  const typeById = useMemo(() => {
    const m = new Map();
    for (const t of safeArray(db.accountTypes).filter((t) => t.companyId === currentCompany.id)) {
      m.set(String(t.id), t);
    }
    return m;
  }, [db.accountTypes, currentCompany.id]);


  const groupById = useMemo(() => {
    const m = new Map();
    for (const g of groups) m.set(String(g.id), g);
    return m;
  }, [groups]);

  const groupByNameLower = useMemo(() => {
    const m = new Map();
    for (const g of groups) m.set(String(g.name || '').trim().toLowerCase(), g);
    return m;
  }, [groups]);


  const typeRowToParent = (t) => {
    const main = String(t?.main || '').trim();
    const cls = String(t?.accountClass || '').trim();
    if (main === 'P&L') {
      if (cls === 'Expense') return 'Expenses';
      return 'Income';
    }
    if (cls === 'Liability' || cls === 'Equity') return 'Liabilities';
    return 'Assets';
  };

  const deriveParentFromLedger = (ledger) => {
    const main = String(ledger?.main || '').trim();
    const t = String(ledger?.type || '').trim();
    if (main === 'P&L') return t === 'Expense' ? 'Expenses' : 'Income';
    if (t === 'Liability' || t === 'Equity') return 'Liabilities';
    return 'Assets';
  };

  const getDefaultGroupId = (category) => {
    const c = String(category || '').trim();
    if (c === 'Customer') {
      const g = groups.find((x) => String(x.name || '').trim().toLowerCase() === 'sundry debtors');
      return g ? String(g.id) : '';
    }
    if (c === 'Vendor') {
      const g = groups.find((x) => String(x.name || '').trim().toLowerCase() === 'sundry creditors');
      return g ? String(g.id) : '';
    }
    if (c === 'Expense') {
      const g = groups.find((x) => String(x.name || '').trim().toLowerCase() === 'indirect expenses');
      return g ? String(g.id) : '';
    }

    const cash = groups.find((x) => String(x.name || '').trim().toLowerCase() === 'cash-in-hand');
    if (cash) return String(cash.id);

    const g = groups.find((x) => String(x.name || '').trim().toLowerCase() === 'primary');
    return g ? String(g.id) : '';
  };

  const groupCategoryToLedgerCategory = (groupCategory) => {
    const c = String(groupCategory || '').trim();
    if (c === 'Customer') return 'Customer';
    if (c === 'Vendor') return 'Vendor';
    if (c === 'Expense') return 'Expense';
    return 'General';
  };

  const [formData, setFormData] = useState(() => {
    if (isEdit) {
      return {
        name: String(initialData?.name || ''),
        groupId: initialData?.groupId ? String(initialData.groupId) : '',
        parent: deriveParentFromLedger(initialData),
        openingBalance: Number(initialData?.balance || 0),
      };
    }

    return {
      name: '',
      groupId: getDefaultGroupId('General'),
      parent: 'Assets',
      openingBalance: 0,
    };
  });

  const filteredGroupOptions = useMemo(() => {
    const selectedId = String(formData.groupId || '').trim();
    const parent = String(formData.parent || '').trim();
    const out = [];
    for (const g of groups) {
      const t = typeById.get(String(g.typeId)) || null;
      const p = t ? typeRowToParent(t) : '';
      if (String(g.id) === selectedId || !parent || p === parent) {
        out.push({ value: String(g.id), label: String(g.name || '').trim() });
      }
    }
    out.sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
    return out;
  }, [groups, typeById, formData.groupId, formData.parent]);

  const handleSubmit = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const name = String(formData.name || '').trim();
    const groupValue = String(formData.groupId || '').trim();
    const openingBalance = Number(formData.openingBalance || 0);

    if (!name) {
      notify.error('Account name is required');
      return;
    }
    if (!groupValue) {
      notify.error('Group is required');
      return;
    }

    const group = groupById.get(groupValue) || null;
    if (!group) {
      notify.error('Please select a valid group.');
      return;
    }

    const typeRow = typeById.get(String(group.typeId));
    if (!typeRow) {
      notify.error('Parent mapping not found for selected group');
      return;
    }

    const derivedType = String(typeRow.accountClass || '').trim();
    const derivedSubType = String(typeRow.name || '').trim();
    const derivedMain = String(typeRow.main || '').trim();

    const derivedLedgerCategory = groupCategoryToLedgerCategory(group.groupCategory);

    const existing = safeArray(db.chartOfAccounts).filter((a) => a.companyId === currentCompany.id);

    const existingCodes = new Set(existing.map((a) => String(a.code || '').trim().toLowerCase()).filter(Boolean));
    const prefix = derivedLedgerCategory === 'Customer' ? 'CUST' : derivedLedgerCategory === 'Vendor' ? 'VEND' : derivedLedgerCategory === 'Expense' ? 'EXP' : 'LED';

    const makeAutoCode = (seed) => {
      let c = `${prefix}-${seed}`;
      while (existingCodes.has(String(c).toLowerCase())) {
        c = `${prefix}-${Math.floor(Math.random() * 1000000)}`;
      }
      return c;
    };

    if (isEdit) {
      const nextCode = String(initialData?.code || '').trim() || makeAutoCode(initialData?.id || Date.now());
      const updated = {
        ...initialData,
        code: nextCode,
        name,
        ledgerCategory: derivedLedgerCategory,
        groupId: Number(group.id),
        type: derivedType,
        subType: derivedSubType,
        main: derivedMain,
        balance: Number.isFinite(openingBalance) ? openingBalance : 0,
        updatedAt: new Date().toISOString(),
      };

      setDb({
        ...db,
        chartOfAccounts: safeArray(db.chartOfAccounts).map((a) =>
          a.companyId === currentCompany.id && String(a.id) === String(initialData.id) ? updated : a
        ),
      });

      onCreated?.(updated);
      onClose?.();
      return;
    }

    const nextId =
      safeArray(db.chartOfAccounts).reduce((m, a) => Math.max(m, Number(a?.id || 0)), 0) + 1;

    const autoCode = makeAutoCode(nextId);

    const newAccount = {
      id: nextId,
      companyId: currentCompany.id,
      code: autoCode,
      name,
      ledgerCategory: derivedLedgerCategory,
      groupId: Number(group.id),
      type: derivedType,
      subType: derivedSubType,
      main: derivedMain,
      balance: Number.isFinite(openingBalance) ? openingBalance : 0,
      createdAt: new Date().toISOString(),
    };

    setDb({
      ...db,
      chartOfAccounts: [...safeArray(db.chartOfAccounts), newAccount],
    });

    onCreated?.(newAccount);
    onClose?.();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="ui-label" htmlFor="accountpicker-ledger-name">Ledger Name</label>
        <input id="accountpicker-ledger-name"
          type="text"
          value={formData.name}
          onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
          className="ui-input w-full"
          placeholder="e.g., ABC Traders"
          required
        />
      </div>

      <div>
        <PopupSelect
          label="Parent"
          value={formData.parent}
          onChange={(val) => setFormData((p) => ({ ...p, parent: String(val || '').trim() }))}
          options={['Assets', 'Liabilities', 'Income', 'Expenses'].map((p) => ({ value: p, label: p }))}
          placeholder="Select parent"
          title="Select Parent"
          showValueSubtext={false}
        />
      </div>

      <div>
        <PopupSelect
          label="Group"
          value={formData.groupId}
          onChange={(val) => {
            const raw = String(val || '').trim();
            if (!raw) {
              setFormData((p) => ({ ...p, groupId: '' }));
              return;
            }

            const byId = groupById.get(raw);
            if (byId) {
              setFormData((p) => ({ ...p, groupId: String(byId.id) }));
              return;
            }

            const byName = groupByNameLower.get(raw.toLowerCase());
            if (byName) {
              setFormData((p) => ({ ...p, groupId: String(byName.id) }));
              return;
            }

            setFormData((p) => ({ ...p, groupId: '' }));
          }}
          options={filteredGroupOptions}
          placeholder="Select group"
          title="Select Group"
          showValueSubtext={false}
          maxWidthClass="max-w-2xl"
        />
      </div>

      <div>
        <label className="ui-label" htmlFor="accountpicker-opening-balance">Opening Balance</label>
        <input id="accountpicker-opening-balance"
          type="number"
          value={formData.openingBalance}
          onChange={(e) => setFormData((p) => ({ ...p, openingBalance: e.target.value }))}
          className="ui-input w-full"
          step="0.01"
        />
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border ui-hover-sunken">
          Cancel
        </button>
        <button type="submit" className="px-4 py-2 rounded-lg ui-primary-bg">
          {isEdit ? 'Update' : 'Create'}
        </button>
      </div>
    </form>
  );
};

const AccountPicker = ({ db, setDb, currentCompany, value, onChange, label = 'Account' }) => {
  const accounts = useMemo(() => {
    return safeArray(db.chartOfAccounts)
      .filter((a) => a.companyId === currentCompany.id)
      .slice()
      .sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
  }, [db.chartOfAccounts, currentCompany.id]);

  const triggerRef = useRef(null);
  const [showPopup, setShowPopup] = useState(false);
  const [mode, setMode] = useState('select');
  const [search, setSearch] = useState('');

  /*
   * The party masters print their own header — the title and every way out of
   * the form — so the dialog does not print a second one above it. Everything
   * else here is a plain panel and is titled by the dialog.
   */
  const modalTitle =
    mode === 'choose'
      ? 'Create'
      : mode === 'createOther'
        ? 'Create Ledger'
        : mode === 'createCustomer' || mode === 'createVendor'
          ? ''
          : mode === 'create'
            ? 'Create Account'
            : 'Select Account';
  const creationMode = ['createVendor', 'createCustomer', 'createOther', 'create'].includes(mode);
  const Overlay = creationMode ? Drawer : Modal;
  const overlayTitle = creationMode
    ? mode === 'createVendor'
      ? 'Create Vendor'
      : mode === 'createCustomer'
        ? 'Create Customer'
        : 'Create Ledger'
    : modalTitle;

  const selected = value ? accounts.find((a) => String(a.id) === String(value)) : null;
  const selectedLabel = selected ? `${selected.code ? `${selected.code} - ` : ''}${selected.name}` : '';

  const normalizedSearch = String(search || '').trim().toLowerCase();
  const recents = useRecentPicks('account', currentCompany?.id);

  // A ledger code is typed, not read, so a code hit outranks the same string
  // appearing inside another account's name. Unfiltered, the ledgers this
  // operator actually posts to come first.
  const filtered = normalizedSearch
    ? rankedSearch(accounts, normalizedSearch, {
        fields: (a) => [a.name, a.ledgerCategory, a.type, a.subType],
        codes: (a) => [a.code],
      })
    : recents.promote(accounts);

  // Focus goes back to the field that opened this, so the next Tab continues
  // the form instead of restarting at the top of the page.
  const closePopup = ({ advance = false } = {}) => {
    setShowPopup(false);
    setMode('select');
    setSearch('');
    requestAnimationFrame(() => {
      // Choosing moves on; cancelling stays put. See focusNextAfter.
      if (advance) focusNextAfter(triggerRef.current);
      else triggerRef.current?.focus({ preventScroll: true });
    });
  };

  const chooseAccount = (account) => {
    if (!account) return;
    recents.remember(account.id);
    onChange?.(String(account.id));
    closePopup({ advance: true });
  };

  const openPopup = () => {
    setMode('select');
    setSearch('');
    setShowPopup(true);
  };

  const accountSearchOpts = {
    fields: (a) => [a.name, a.ledgerCategory, a.type, a.subType],
    codes: (a) => [a.code],
  };

  /*
   * Tab out of the search box takes the one match, when there is exactly one.
   *
   * Requirement 15 says highlight without auto-selecting while somebody is
   * still typing; section 9 says a full code should not have to be confirmed.
   * Both hold at once if the selection happens on the way out of the field
   * rather than on every keystroke.
   */
  const onAccountSearchTab = (e) => {
    if (e.key !== 'Tab' || e.shiftKey) return;
    const sole = soleConfidentMatch(accounts, search, accountSearchOpts);
    if (!sole) return;
    // Swallow the Tab: the dialog's focus trap would otherwise move focus
    // inside a dialog that is closing on this very keystroke.
    e.preventDefault();
    e.stopPropagation();
    chooseAccount(sole);
  };

  const accountRecentCount = normalizedSearch ? 0 : recents.recentCount(filtered);

  const {
    activeIndex: accountActiveIndex,
    setActiveIndex: setAccountActiveIndex,
    listRef: accountListRef,
    onKeyDown: onAccountListKeys,
  } = useListboxKeys({
    count: filtered.length,
    onChoose: (i) => chooseAccount(filtered[i]),
    onCancel: () => closePopup(),
    // Tab off a list nobody drove: leave the value alone and carry on,
    // rather than snapping back to the field just left.
    onTabOut: () => closePopup({ advance: true }),
  });

  // A plain render function, not a component defined during render: the
  // latter gets a fresh component type on every parent render, so React
  // unmounts and remounts the whole subtree (and any state in it) each time.
  const renderCreateChooser = () => {
    return (
      <div className="space-y-6">
        <div className="text-sm ui-muted">Choose what you want to create:</div>
        <div className="grid grid-cols-1 gap-3">
          <button
            type="button"
            onClick={() => setMode('createVendor')}
            className="w-full text-left px-4 py-3 rounded-lg border ui-surface ui-hover-sunken ui-border-c"
          >
            <div className="font-semibold">1. Vendor</div>
            <div className="text-xs ui-muted">Opens vendor creation form</div>
          </button>

          <button
            type="button"
            onClick={() => setMode('createCustomer')}
            className="w-full text-left px-4 py-3 rounded-lg border ui-surface ui-hover-sunken ui-border-c"
          >
            <div className="font-semibold">2. Customer</div>
            <div className="text-xs ui-muted">Opens customer creation form</div>
          </button>

          <button
            type="button"
            onClick={() => setMode('createOther')}
            className="w-full text-left px-4 py-3 rounded-lg border ui-surface ui-hover-sunken ui-border-c"
          >
            <div className="font-semibold">3. Others</div>
            <div className="text-xs ui-muted">Create any ledger other than Vendor/Customer ledgers</div>
          </button>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setMode('select')} className="px-4 py-2 rounded-lg border ui-hover-sunken">
            Back
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      {label ? <label className="ui-label">{label}</label> : null}
      <button
        ref={triggerRef}
        type="button"
        onClick={openPopup}
        onKeyDown={openOnKey(openPopup)}
        aria-haspopup="listbox"
        aria-expanded={showPopup}
        className="w-full px-3 py-2 border rounded-lg ui-surface text-left"
      >
        {selectedLabel || 'Select Account'}
      </button>

      {showPopup && (
        <Overlay open={creationMode || undefined} onClose={() => closePopup()} title={overlayTitle} widthClass="ui-form-drawer" maxWidthClass={
            mode === 'choose'
              ? 'max-w-lg'
              : mode === 'createCustomer' || mode === 'createVendor'
                ? 'max-w-5xl'
                : 'max-w-2xl'
          }
        >
          {mode === 'select' ? (
            <div className="space-y-3">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                    onAccountSearchTab(e);
                    onAccountListKeys(e);
                  }}
                role="combobox"
                aria-expanded="true"
                aria-controls="account-picker-list"
                aria-activedescendant={
                  filtered[accountActiveIndex] ? `account-opt-${filtered[accountActiveIndex].id}` : undefined
                }
                className="ui-input w-full"
                                /*
                * The dialog decides who gets the caret, and it looks for
                * this attribute. React's own autoFocus runs first and is
                * then overruled: the dialog found nothing claiming focus
                * and took it for the panel itself, so every keystroke went
                * to a div. The arrows moved nothing and Enter chose
                * nothing, while Escape still worked — because the dialog
                * listens for that one on the window.
                */
                data-autofocus="true"
                placeholder="Search account (code, name, type)"
                autoFocus
              />

              <div
                id="account-picker-list"
                ref={accountListRef}
                role="listbox"
                className="max-h-80 overflow-y-auto space-y-1"
              >
                {filtered.length === 0 ? (
                  <div className="text-sm ui-muted">No accounts found.</div>
                ) : (
                  filtered.map((a, i) => {
                    const on = i === accountActiveIndex;
                    return (
                      <React.Fragment key={a.id}>
                      {/* The habitual rows, called what they are. */}
                      {accountRecentCount && i === 0 ? (
                        <div className="ui-caption px-1 pt-1 pb-0.5">Recently used</div>
                      ) : null}
                      {accountRecentCount && i === accountRecentCount ? (
                        <div className="ui-caption px-1 pt-2 pb-0.5">All accounts</div>
                      ) : null}
                      <button
                        id={`account-opt-${a.id}`}
                        type="button"
                        role="option"
                        aria-selected={String(a.id) === String(value)}
                        data-active={on || undefined}
                        onMouseEnter={() => setAccountActiveIndex(i)}
                        onClick={() => chooseAccount(a)}
                        className={`w-full text-left px-3 py-2 rounded-lg border ${
                          on ? '' : 'ui-hover-sunken '
                        }${String(a.id) === String(value) && !on ? 'ui-sunken ui-border-c' : 'ui-border-c'}`}
                        /* Filled, not outlined: the cursor row shared `ui-sunken`
                           with the already-chosen row and differed only by border
                           colour, so pressing the down arrow looked like nothing
                           had happened. */
                        style={
                          on
                            ? {
                                backgroundColor: 'rgb(var(--brand))',
                                borderColor: 'rgb(var(--brand))',
                                color: 'rgb(var(--on-brand))',
                              }
                            : undefined
                        }
                      >
                        <div className={`text-sm font-medium ${on ? '' : 'ui-fg'}`}>{a.code ? `${a.code} - ` : ''}{a.name}</div>
                        {(a.type || a.subType || a.ledgerCategory) && (
                          <div className={`text-xs truncate ${on ? 'opacity-80' : 'ui-muted'}`}>{[a.ledgerCategory, a.type, a.subType].filter(Boolean).join(' • ')}</div>
                        )}
                      </button>
                      </React.Fragment>
                    );
                  })
                )}
              </div>

              {normalizedSearch && filtered.length === 0 && (
                <button
                  type="button"
                  onClick={() => setMode('choose')}
                  className="w-full px-4 py-2 ui-primary-bg rounded-lg"
                >
                  Create new account
                </button>
              )}
            </div>
          ) : mode === 'choose' ? (
            renderCreateChooser()
          ) : mode === 'createVendor' ? (
            <VendorForm
              db={db}
              setDb={setDb}
              currentCompany={currentCompany}
              onCreated={(vendor) => {
                const ledgerId = vendor?.accountId ? String(vendor.accountId) : '';
                if (ledgerId) onChange?.(ledgerId);
                closePopup();
              }}
              onClose={() => closePopup()}
            />
          ) : mode === 'createCustomer' ? (
            <CustomerForm
              db={db}
              setDb={setDb}
              currentCompany={currentCompany}
              onCreated={(customer) => {
                const ledgerId = customer?.accountId ? String(customer.accountId) : '';
                if (ledgerId) onChange?.(ledgerId);
                closePopup();
              }}
              onClose={() => closePopup()}
            />
          ) : (
            <AccountForm
              db={db}
              setDb={setDb}
              currentCompany={currentCompany}
              excludeGroupCategories={['Customer', 'Vendor']}
              onCreated={(acc) => onChange?.(String(acc.id))}
              onClose={() => closePopup()}
            />
          )}
        </Overlay>
      )}
    </>
  );
};

export default AccountPicker;
