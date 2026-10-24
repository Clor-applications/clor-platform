import { orgId as platformOrgId } from '@platform/context';
/** Helpers the Accounting app's screens share, moved out of App.jsx (behaviour unchanged). */
import { Fragment, useMemo, useRef, useState } from 'react';
import { useFeatures } from '@ui/permissions/useFeatures';
import useEnabledCurrencies from './hooks/useEnabledCurrencies';
import { TDS_NATURES, natureForSection, resolveRule, ruleReference } from './features/tds/ruleMaster';
import { ledgerHasPostings, openingTypeForNature, tdsLedgerNature, tdsSectionSummary, validateLedger } from '@ui/utils/ledgerMaster';
import { createLedgerAccount } from '@ui/api/ledger';
import { notify } from '@ui/components/ui/notify';
import { round2 } from '@ui/utils/money';
import { linkTdsPayableLedger } from './features/tds/tdsMapping';
import { AddressTab, ContactsTab, FormRow as PartyFormRow } from './components/pickers/customerFormParts';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { lookupGstin } from '@ui/api/masters';
import { Search } from 'lucide-react';
import { todayIso } from '@ui/utils/dates';
import { tdsSection } from '@ui/utils/tds';
import { DocFormActions } from '@ui/components/DocumentForm';
import { saveMaster } from '@ui/utils/masterSync';
import MasterFormPage from '@ui/components/MasterFormPage';
import { GST_STATE_BY_CODE } from '@ui/utils/gst';

/* The state list the ledger address table offers, same source as everywhere. */
export const LEDGER_STATES = Object.entries(GST_STATE_BY_CODE)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const normalizeId = (v) => String(v ?? '').trim();

/*
 * Handed to the ledger field through the registry, rather than reached for.
 *
 * The field used to `lazy(() => import('../../App'))` to find this, which made
 * a cycle: App imports the field, the field imports App. Registering it here
 * points both at a third, tiny module instead.
 */
export const ChartAccountForm = ({
  db,
  setDb,
  currentCompany,
  openModal,
  onClose,
  initialData = null,
  initialName = '',
  onCreated,
  excludeGroupCategories = [],
  includeGroupIds = null,
}) => {
  const excludedCats = new Set((Array.isArray(excludeGroupCategories) ? excludeGroupCategories : []).map((x) => String(x || '').trim()));
  const includeIds = includeGroupIds ? new Set((Array.isArray(includeGroupIds) ? includeGroupIds : []).map((x) => String(x))) : null;

  const groups = (Array.isArray(db.accountGroups) ? db.accountGroups : [])
    .filter((g) => g.companyId === currentCompany.id)
    .filter((g) => !g.isLegacy)
    .filter((g) => !excludedCats.has(String(g.groupCategory || '').trim()))
    .filter((g) => (includeIds ? includeIds.has(String(g.id)) : true))
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const types = (Array.isArray(db.accountTypes) ? db.accountTypes : [])
    .filter((t) => t.companyId === currentCompany.id)
    .filter((t) => !t.isLegacy)
    .slice();

  const typeById = useMemo(() => {
    const m = new Map();
    for (const t of types) m.set(String(t.id), t);
    return m;
  }, [db.accountTypes, currentCompany.id]);

  const groupById = useMemo(() => {
    const m = new Map();
    for (const g of groups) m.set(String(g.id), g);
    return m;
  }, [db.accountGroups, currentCompany.id]);

  const isUnderNamedRoot = useMemo(() => {
    return (groupId, rootLowerName) => {
      let cur = groupById.get(String(groupId || '')) || null;
      const seen = new Set();
      while (cur && !seen.has(String(cur.id))) {
        seen.add(String(cur.id));
        const nm = String(cur.name || '').trim().toLowerCase();
        if (nm === rootLowerName) return true;
        const pid = cur.parentGroupId;
        if (pid === null || pid === undefined || pid === '') return false;
        cur = groupById.get(String(pid)) || null;
      }
      return false;
    };
  }, [groupById]);

  const groupByNameLower = useMemo(() => {
    const m = new Map();
    for (const g of groups) m.set(String(g.name || '').trim().toLowerCase(), g);
    return m;
  }, [groups]);

  /*
   * The chart is a tree, and the tree is the thing being chosen from: "TDS
   * Payable" means one thing under Duties & Taxes and another on its own. So
   * the list is offered in tree order with each level indented, rather than as
   * an alphabetical run in which a child sits nowhere near its parent.
   *
   * Search still matches the plain name — the indent is on the label, and a
   * group whose parent is missing (a chart that only half loaded) is listed at
   * the root rather than dropped.
   */
  const groupOptions = useMemo(() => {
    const childrenOf = new Map();
    const present = new Set(groups.map((g) => String(g.id)));
    for (const g of groups) {
      const parent = String(g.parentGroupId ?? '').trim();
      const key = parent && present.has(parent) ? parent : '';
      if (!childrenOf.has(key)) childrenOf.set(key, []);
      childrenOf.get(key).push(g);
    }

    const out = [];
    const walk = (key, depth) => {
      const kids = (childrenOf.get(key) || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      for (const g of kids) {
        const name = String(g.name || '').trim();
        out.push({ value: String(g.id), label: depth ? `${'\u2007'.repeat(depth * 3)}${name}` : name, searchText: name });
        walk(String(g.id), depth + 1);
      }
    };
    walk('', 0);
    return out;
  }, [groups]);

  const isEdit = Boolean(initialData && (initialData.id !== null && initialData.id !== undefined && String(initialData.id) !== ''));
  const { isEnabled: ledgerFeatureEnabled } = useFeatures();
  const ledgerBaseCurrency = String(currentCompany?.currency || currentCompany?.baseCurrency || 'INR').toUpperCase();
  const ledgerMultiCurrencyEnabled = ledgerFeatureEnabled('multiCurrency');
  const { options: ledgerCurrencyOptions } = useEnabledCurrencies(currentCompany);
  const defaultGroupForEdit = isEdit ? String(initialData?.groupId ?? '').trim() : '';

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

  const [formData, setFormData] = useState({
    name: isEdit ? String(initialData?.name || '').trim() : String(initialName || '').trim(),
    // When the caller restricts the groups (creating an expense ledger from the
    // expense voucher, say), the default has to be one of those — the usual
    // Cash-in-Hand default is not on the list and would render as blank.
    groupId: isEdit
      ? defaultGroupForEdit
      : includeIds
        ? String(
            groups.find((g) => String(g.name || '').trim().toLowerCase() === 'indirect expenses')?.id ??
              groups[0]?.id ??
              ''
          )
        : getDefaultGroupId('General'),
    openingBalance: isEdit ? Number(initialData?.openingBalance ?? initialData?.balance ?? 0) : 0,
    bankName: isEdit ? String(initialData?.bankDetails?.bankName || '').trim() : '',
    bankAccountNumber: isEdit ? String(initialData?.bankDetails?.accountNumber || '').trim() : '',
    bankBranch: isEdit ? String(initialData?.bankDetails?.branch || '').trim() : '',
    bankIfsc: isEdit ? String(initialData?.bankDetails?.ifsc || '').trim() : '',
    gstRate: isEdit ? String(initialData?.gstRate ?? '') : '',

    /*
     * The rest of the ledger master. Everything here is optional and none of it
     * changes how a ledger posts — the group still decides that. It is the
     * information a bank ledger, a TDS ledger or a statutory ledger needs
     * carried with it, which previously had nowhere to live.
     */
    currency: ledgerMultiCurrencyEnabled && isEdit ? String(initialData?.currency || ledgerBaseCurrency) : ledgerBaseCurrency,
    exchangeRate: isEdit ? String(initialData?.exchangeRate || '') : '',
    openingBalanceType: isEdit ? String(initialData?.openingBalanceType || 'Dr') : 'Dr',
    bankAccountType: isEdit ? String(initialData?.bankDetails?.accountType || 'Current Account') : 'Current Account',
    bankHolderName: isEdit ? String(initialData?.bankDetails?.holderName || '') : '',
    bankUpiId: isEdit ? String(initialData?.bankDetails?.upiId || '') : '',
    bankBranchAddress: isEdit ? String(initialData?.bankDetails?.branchAddress || '') : '',
    pan: isEdit ? String(initialData?.pan || '') : '',
    gstin: isEdit ? String(initialData?.gstin || '') : '',
    tdsSection: isEdit ? String(initialData?.tdsSection || '') : '',
    /* Rows written before natures existed carry only a section; the nature is
       read back from it so an old ledger keeps working and is saved forward. */
    tdsNatureCode: isEdit
      ? String(initialData?.tdsNatureCode || natureForSection(initialData?.tdsSection)?.code || '')
      : '',
    tdsRate: isEdit ? String(initialData?.tdsRate ?? '') : '',
    tdsApplicable: isEdit ? initialData?.tdsApplicable === true : false,
    /* Availability on transactions — an inactive ledger stays in the chart
       with its history, and out of every picker. */
    isActive: isEdit ? initialData?.isActive !== false : true,
    addresses: Array.isArray(initialData?.addresses) ? initialData.addresses : [],
    contacts: Array.isArray(initialData?.contacts) ? initialData.contacts : [],
  });

  const [ledgerTab, setLedgerTab] = useState('');
  const [gstinFetching, setGstinFetching] = useState(false);
  /*
   * Dr or Cr follows the group's accounting nature until somebody says
   * otherwise — a bank overdraft is a real credit balance on an asset group.
   * Once they have chosen a side, changing the group must not take it back.
   */
  const [openingTypeTouched, setOpeningTypeTouched] = useState(isEdit);

  /*
   * A ledger with entries against it keeps its group. Re-filing it moves every
   * figure it holds onto another statement, and nothing in the entries records
   * that it happened. The name stays editable: a rename changes no total.
   */
  const groupLocked = useMemo(
    () => isEdit && ledgerHasPostings({ journalEntries: db.journalEntries, companyId: currentCompany.id, ledgerId: initialData?.id }),
    [isEdit, db.journalEntries, currentCompany.id, initialData?.id]
  );

  const applyGroup = (groupId) => {
    setFormData((p) => {
      const next = { ...p, groupId: String(groupId || '') };
      const group = groupById.get(String(groupId || '').trim());
      const type = group ? typeById.get(String(group.typeId)) : null;
      if (String(type?.main || '').trim() === 'P&L') {
        next.openingBalance = 0;
        next.openingBalanceType = openingTypeForNature(type?.accountClass);
      }
      if (!openingTypeTouched) {
        next.openingBalanceType = openingTypeForNature(type?.accountClass);
      }
      return next;
    });
  };

  const isBankGroupSelected = useMemo(() => {
    const gid = String(formData.groupId || '').trim();
    if (!gid) return false;
    return isUnderNamedRoot(gid, 'bank accounts');
  }, [formData.groupId, isUnderNamedRoot]);

  const isCashGroupSelected = useMemo(() => {
    const gid = String(formData.groupId || '').trim();
    if (!gid) return false;
    return isUnderNamedRoot(gid, 'cash-in-hand');
  }, [formData.groupId, isUnderNamedRoot]);

  // Expense ledgers carry a default GST rate: expense booking reads it so an
  // operator picking "Office Rent" gets its 18% without remembering it.
  const isExpenseGroupSelected = useMemo(() => {
    const g = groupById.get(String(formData.groupId || '').trim());
    return String(g?.groupCategory || '').trim() === 'Expense';
  }, [formData.groupId, groupById]);

  const isProfitLossGroupSelected = useMemo(() => {
    const group = groupById.get(String(formData.groupId || '').trim());
    const type = group ? typeById.get(String(group.typeId)) : null;
    return String(type?.main || '').trim() === 'P&L';
  }, [formData.groupId, groupById, typeById]);

  /*
   * Which tabs this ledger shows, decided by the group it is under.
   *
   * "One form, dynamic behaviour": the group is the accounting context, so it
   * is the group that says whether a ledger needs bank fields, a TDS section or
   * a statutory identifier. A tab the group does not call for is not shown —
   * an Indirect Expenses ledger should not offer somewhere to type an IFSC.
   */
  const isTdsGroupSelected = useMemo(() => {
    const gid = String(formData.groupId || '').trim();
    if (!gid) return false;
    const name = String(groupById.get(gid)?.name || '').toLowerCase();
    return /\btds\b/.test(name) || isUnderNamedRoot(gid, 'duties & taxes') && /\btds\b/.test(name);
  }, [formData.groupId, groupById, isUnderNamedRoot]);

  const isTcsGroupSelected = useMemo(() => {
    const gid = String(formData.groupId || '').trim();
    if (!gid) return false;
    return /\btcs\b/.test(String(groupById.get(gid)?.name || '').toLowerCase());
  }, [formData.groupId, groupById]);

  const isDutiesGroupSelected = useMemo(() => {
    const gid = String(formData.groupId || '').trim();
    return gid ? isUnderNamedRoot(gid, 'duties & taxes') : false;
  }, [formData.groupId, isUnderNamedRoot]);

  const ledgerTabs = useMemo(() => {
    const tabs = [];
    if (isBankGroupSelected) tabs.push({ key: 'bank', label: 'Bank Details' });
    if (isTdsGroupSelected) tabs.push({ key: 'tds', label: 'TDS Mapping' });
    if (isTcsGroupSelected) tabs.push({ key: 'tcs', label: 'TCS Details' });
    if (isDutiesGroupSelected && !isTdsGroupSelected && !isTcsGroupSelected) tabs.push({ key: 'gst', label: 'GST Details' });
    if (isExpenseGroupSelected) tabs.push({ key: 'gst', label: 'GST Details' });
    tabs.push({ key: 'statutory', label: 'Statutory Details' });
    tabs.push({ key: 'address', label: 'Address' });
    tabs.push({ key: 'contacts', label: 'Contact Persons' });
    return tabs;
  }, [isBankGroupSelected, isTdsGroupSelected, isTcsGroupSelected, isDutiesGroupSelected, isExpenseGroupSelected]);

  /* Changing the group can remove the tab that was open. */
  const activeLedgerTab = ledgerTabs.some((t) => t.key === ledgerTab) ? ledgerTab : ledgerTabs[0]?.key || '';

  // A cash/bank chart ledger must also exist as a server ledger account —
  // that is what the receipt/payment "mode" dropdown and GL postings use.
  // Best-effort: an offline save keeps the chart row; sync retries next edit.
  const syncCashBankLedgerToServer = async (chartRow) => {
    if (!isBankGroupSelected && !isCashGroupSelected) return;
    try {
      const { account } = await createLedgerAccount({
        name: chartRow.name,
        accountType: 'ASSET',
        controlKind: isBankGroupSelected ? 'BANK' : 'CASH',
        sourceKey: `coa-${currentCompany.id}-${chartRow.id}`,
      });
      if (account?.id) {
        setDb((prev) => ({
          ...prev,
          chartOfAccounts: (Array.isArray(prev.chartOfAccounts) ? prev.chartOfAccounts : []).map((a) =>
            a.companyId === currentCompany.id && String(a.id) === String(chartRow.id)
              ? { ...a, serverLedgerAccountId: account.id }
              : a
          ),
        }));
        notify.success(`${chartRow.name} is now available in Payment/Receipt entry.`);
      }
    } catch (err) {
      notify.error(`Ledger saved locally, but server sync failed: ${String(err?.message || err)}`);
    }
  };

  const openCreateGroupFromPicker = (typedName) => {
    openModal(
      <SimpleAccountGroupCreateForm
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        initialName={String(typedName || '').trim()}
        onCreated={(g) => {
          if (g?.id !== null && g?.id !== undefined) {
            setFormData((p) => ({ ...p, groupId: String(g.id) }));
          }
        }}
        onClose={() => openModal(null)}
      />,
      { title: 'New Group', maxWidthClass: 'max-w-2xl' }
    );
  };

  /*
   * Which of the two saves the menu asked for. A ref, not state: the menu item
   * submits the form in the same click, and a state update would not have
   * landed by the time this reads it.
   */
  const saveAndNewRef = useRef(false);

  const handleSubmit = (e, mode = 'close') => {
    e.preventDefault();
    // Quick-create is rendered in a portal owned by a document form. React
    // events still bubble through that component tree, so without this the
    // same click also submits and closes the expense/bill/journal underneath.
    e.stopPropagation();
    if (saveAndNewRef.current) {
      saveAndNewRef.current = false;
      mode = 'new';
    }

    const name = String(formData.name || '').trim();
    const openingBalance = isProfitLossGroupSelected ? 0 : round2(Number(formData.openingBalance || 0));

    const groupValue = String(formData.groupId || '').trim();
    const groupRow = groupValue ? groupById.get(groupValue) || null : null;

    /*
     * Everything the master refuses, in one place and in the order a person
     * meets it: the name, the group, an identifier that cannot be what it
     * claims to be. The tab a bad field sits on is opened rather than the
     * message pointing at somewhere invisible.
     */
    const complaint = validateLedger({
      values: formData,
      group: groupRow,
      ledgers: db.chartOfAccounts,
      companyId: currentCompany.id,
      isEdit,
      ledgerId: initialData?.id,
      needsBank: isBankGroupSelected,
      needsTds: isTdsGroupSelected,
    });
    if (complaint) {
      const tabForField = { bankName: 'bank', bankAccountNumber: 'bank', bankIfsc: 'bank', pan: 'statutory', gstin: 'statutory', tdsSection: 'tds' };
      if (tabForField[complaint.field]) setLedgerTab(tabForField[complaint.field]);
      notify.error(complaint.message);
      return;
    }

    const typeRow = groupRow ? typeById.get(String(groupRow.typeId)) : null;
    if (!typeRow) {
      notify.error('Parent mapping not found for selected group');
      return;
    }

    const derivedType = String(typeRow.accountClass || '').trim();
    const derivedSubType = String(typeRow.name || '').trim();
    const derivedMain = String(typeRow.main || '').trim();

    const derivedLedgerCategory = groupCategoryToLedgerCategory(groupRow?.groupCategory);

    let bankDetails = undefined;
    if (isBankGroupSelected) {
      const bankName = String(formData.bankName || '').trim();
      const accountNumber = String(formData.bankAccountNumber || '').trim();
      const branch = String(formData.bankBranch || '').trim();
      const ifsc = String(formData.bankIfsc || '').trim().toUpperCase();

      bankDetails = {
        bankName,
        accountNumber,
        branch,
        ifsc,
        accountType: String(formData.bankAccountType || '').trim() || undefined,
        holderName: String(formData.bankHolderName || '').trim() || undefined,
        upiId: String(formData.bankUpiId || '').trim() || undefined,
        branchAddress: String(formData.bankBranchAddress || '').trim() || undefined,
      };
    }

    /*
     * The rest of the master, carried on the ledger. None of it changes how the
     * ledger posts — the group still decides that — so it is assembled here and
     * spread onto the row rather than threaded through the posting logic.
     */
    const ledgerExtras = {
      currency: ledgerMultiCurrencyEnabled ? String(formData.currency || ledgerBaseCurrency) : ledgerBaseCurrency,
      exchangeRate: ledgerMultiCurrencyEnabled && String(formData.currency).toUpperCase() !== ledgerBaseCurrency ? Number(formData.exchangeRate || 0) : 1,
      openingBalanceType: isProfitLossGroupSelected ? undefined : String(formData.openingBalanceType || 'Dr'),
      pan: String(formData.pan || '').trim().toUpperCase() || undefined,
      gstin: String(formData.gstin || '').trim().toUpperCase() || undefined,
      tdsSection: String(formData.tdsSection || '').trim() || undefined,
      tdsNatureCode: String(formData.tdsNatureCode || '').trim() || undefined,
      /* Which side this ledger accumulates, decided by its group — the
         transaction engine offers a payable deduction only payable ledgers. */
      tdsSide: isTdsGroupSelected
        ? String(tdsLedgerNature(groupById.get(String(formData.groupId || '').trim())) || '').toUpperCase()
        : undefined,
      tdsRate: String(formData.tdsRate ?? '').trim() === '' ? undefined : Number(formData.tdsRate),
      tdsApplicable: isExpenseGroupSelected ? formData.tdsApplicable === true : undefined,
      isActive: formData.isActive !== false,
      addresses: (formData.addresses || []).filter((a) => String(a?.label || '').trim()),
      contacts: (formData.contacts || []).filter((c) => String(c?.name || '').trim()),
    };

    const existingCodes = new Set(
      (Array.isArray(db.chartOfAccounts) ? db.chartOfAccounts : [])
        .filter((a) => a.companyId === currentCompany.id)
        .map((a) => String(a.code || '').trim().toLowerCase())
    );

    if (isEdit) {
      const existing = (Array.isArray(db.chartOfAccounts) ? db.chartOfAccounts : []).find(
        (a) => a.companyId === currentCompany.id && String(a.id) === String(initialData.id)
      );
      if (!existing) {
        notify.error('Ledger not found');
        return;
      }

      const updated = {
        ...existing,
        name,
        ledgerCategory: derivedLedgerCategory,
        groupId: Number(groupRow.id),
        type: derivedType,
        subType: derivedSubType,
        main: derivedMain,
        openingBalance: Number.isFinite(openingBalance) ? openingBalance : 0,
        balance: Number.isFinite(openingBalance) ? openingBalance : 0,
        bankDetails,
        ...ledgerExtras,
        gstRate: isExpenseGroupSelected && String(formData.gstRate || '').trim() !== '' ? Number(formData.gstRate) : null,
        updatedAt: new Date().toISOString(),
      };

      const updatedJournalEntries = (Array.isArray(db.journalEntries) ? db.journalEntries : []).map((j) => {
        if (j.companyId !== currentCompany.id) return j;
        const nextLines = (Array.isArray(j.lines) ? j.lines : []).map((l) => {
          if (String(l?.accountId || '').trim() !== String(updated.id)) return l;
          return { ...l, accountName: updated.name, accountCode: updated.code };
        });
        return { ...j, lines: nextLines };
      });

      const nextDb = {
        ...db,
        chartOfAccounts: (Array.isArray(db.chartOfAccounts) ? db.chartOfAccounts : []).map((a) =>
          a.companyId === currentCompany.id && String(a.id) === String(updated.id) ? updated : a
        ),
        journalEntries: updatedJournalEntries,
      };
      setDb(linkTdsPayableLedger(nextDb, currentCompany.id, updated, existing));

      syncCashBankLedgerToServer(updated);
      onCreated?.(updated);
      onClose?.();
      return;
    }

    const nextId = (Array.isArray(db.chartOfAccounts) ? db.chartOfAccounts : []).reduce((m, a) => Math.max(m, Number(a?.id || 0)), 0) + 1;
    const prefix = derivedLedgerCategory === 'Customer' ? 'CUST' : derivedLedgerCategory === 'Vendor' ? 'VEND' : derivedLedgerCategory === 'Expense' ? 'EXP' : 'LED';
    let autoCode = `${prefix}-${nextId}`;
    while (existingCodes.has(autoCode.toLowerCase())) {
      autoCode = `${prefix}-${Math.floor(Math.random() * 1000000)}`;
    }

    const newAccount = {
      id: nextId,
      companyId: currentCompany.id,
      code: autoCode,
      name,
      ledgerCategory: derivedLedgerCategory,
      groupId: Number(groupRow.id),
      type: derivedType,
      subType: derivedSubType,
      main: derivedMain,
      openingBalance: Number.isFinite(openingBalance) ? openingBalance : 0,
      balance: Number.isFinite(openingBalance) ? openingBalance : 0,
      bankDetails,
      ...ledgerExtras,
      gstRate: isExpenseGroupSelected && String(formData.gstRate || '').trim() !== '' ? Number(formData.gstRate) : null,
      createdAt: new Date().toISOString(),
    };

    const nextDb = {
      ...db,
      chartOfAccounts: [...(Array.isArray(db.chartOfAccounts) ? db.chartOfAccounts : []), newAccount],
    };
    setDb(linkTdsPayableLedger(nextDb, currentCompany.id, newAccount));

    syncCashBankLedgerToServer(newAccount);
    onCreated?.(newAccount);

    /*
     * "Save and New" is for the person entering the chart in one sitting. The
     * group stays — the next ledger is almost always a sibling of the one just
     * saved — and everything that describes this particular ledger is cleared.
     */
    if (mode === 'new') {
      setFormData((p) => ({
        ...p,
        name: '',
        openingBalance: 0,
        bankName: '',
        bankAccountNumber: '',
        bankBranch: '',
        bankIfsc: '',
        bankHolderName: '',
        bankUpiId: '',
        bankBranchAddress: '',
        pan: '',
        gstin: '',
        tdsSection: '',
        tdsNatureCode: '',
        tdsRate: '',
        tdsApplicable: false,
        addresses: [],
        contacts: [],
      }));
      notify.success(`Ledger "${name}" created. Next one.`);
      return;
    }

    onClose?.();
  };

  /*
   * The identity of the ledger, in the two columns the party masters use: what
   * it is called and what it opens with on the left, and on the right the three
   * settings that each have one obvious answer.
   */
  const basicDetails = (
    <div className="ui-form-cols"><div>
      <PartyFormRow className="lg:col-start-1 lg:row-start-1" label="Ledger Name" required htmlFor="ledger-name" hint="What this ledger is called in the books and on every posting to it.">
        <input
          id="ledger-name"
          type="text"
          value={formData.name}
          onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
          className="ui-input w-full"
          placeholder="e.g., HDFC Bank - Current Account"
          required
        />
      </PartyFormRow>



      <PartyFormRow className="lg:col-start-1 lg:row-start-2" label="Opening Balance" htmlFor="ledger-opening" hint={isProfitLossGroupSelected ? 'Not applicable to Profit & Loss ledgers.' : 'What this ledger already held on the day the books begin.'}>
        <div className="ui-money-centred">
        <span className="ui-money-symbol pointer-events-none">₹</span>
        <input
          id="ledger-opening"
          type="number"
          value={isProfitLossGroupSelected ? 0 : formData.openingBalance}
          onChange={(e) => setFormData((p) => ({ ...p, openingBalance: e.target.value }))}
          className="ui-input ui-money"
          step="0.01"
          disabled={isProfitLossGroupSelected}
        />
        </div>
      </PartyFormRow>

      <PartyFormRow className="lg:col-start-1 lg:row-start-3" label="Balance Type" hint="Which side the balance opens on. It follows the group's nature until you choose otherwise.">
        {/* Under the balance it qualifies, as on the party masters. */}
        <div className="flex items-center gap-6 pt-1.5">
          {[{ v: 'Dr', l: 'Dr (Default)' }, { v: 'Cr', l: 'Cr' }].map((o) => (
            <label key={o.v} className={`inline-flex items-center gap-2 text-sm ${isProfitLossGroupSelected ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
              <input
                type="radio"
                name="ledgerOpeningType"
                className="ui-radio"
                checked={formData.openingBalanceType === o.v}
                disabled={isProfitLossGroupSelected}
                onChange={() => {
                  setOpeningTypeTouched(true);
                  setFormData((p) => ({ ...p, openingBalanceType: o.v }));
                }}
              />
              {o.l}
            </label>
          ))}
        </div>
      </PartyFormRow>

      {/* The other half is the same shape as this one — a name beside its
          control — on the grid's own rows, so the two cannot drift apart. */}
      <PartyFormRow className="lg:col-start-2 lg:row-start-1" label="Ledger Group" required hint="The group decides which statement this ledger lands on, and which tabs the form offers.">
        <PopupSelect
          label={null}
          ariaLabel="Ledger Group *"
          value={formData.groupId}
          disabled={groupLocked}
          onChange={(val) => {
            const raw = String(val || '').trim();
            if (!raw) {
              applyGroup('');
              return;
            }

            const byId = groupById.get(raw);
            if (byId) {
              applyGroup(String(byId.id));
              return;
            }

            const byName = groupByNameLower.get(raw.toLowerCase());
            applyGroup(byName ? String(byName.id) : '');
          }}
          options={groupOptions}
          placeholder="Select group"
          title="Select Group"
          showValueSubtext={false}
          maxWidthClass="max-w-2xl"
          allowCustom={!groupLocked}
          customActionText="Create new Group"
          onCustomAction={(typed) => openCreateGroupFromPicker(typed)}
        />
        {groupLocked ? (
          <p className="ui-caption mt-1">
            Entries have been posted to this ledger, so its group is fixed — moving it would move those figures onto another statement.
          </p>
        ) : null}
      </PartyFormRow>

      {ledgerMultiCurrencyEnabled ? <PartyFormRow className="lg:col-start-2 lg:row-start-2" label="Currency" required htmlFor="ledger-currency" hint="The currency this ledger is kept in. The books are reported in the company's base currency.">
        <select
          id="ledger-currency"
          value={formData.currency}
          onChange={(e) => setFormData((p) => ({ ...p, currency: e.target.value }))}
          className="ui-select w-full"
        >
          {ledgerCurrencyOptions.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </PartyFormRow> : null}

      {ledgerMultiCurrencyEnabled && String(formData.currency || '').toUpperCase() !== ledgerBaseCurrency ? (
        <PartyFormRow className="lg:col-start-2 lg:row-start-3" label={`Conversion rate to ${ledgerBaseCurrency}`} required htmlFor="ledger-exchange-rate">
          <input id="ledger-exchange-rate" type="number" min="0.000001" step="0.000001" value={formData.exchangeRate} onChange={(event) => setFormData((previous) => ({ ...previous, exchangeRate: event.target.value }))} className="ui-input w-full" required />
        </PartyFormRow>
      ) : null}

      {isExpenseGroupSelected ? (
        <PartyFormRow
          className="lg:col-start-2 lg:row-start-3"
          label="TDS Applicable"
          htmlFor="ledger-tds-applicable"
          hint="Only applicable expense ledgers are included when TDS is calculated on an expense voucher."
        >
          <select
            id="ledger-tds-applicable"
            value={formData.tdsApplicable ? 'yes' : 'no'}
            onChange={(e) => setFormData((p) => ({ ...p, tdsApplicable: e.target.value === 'yes' }))}
            className="ui-select w-full"
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </PartyFormRow>
      ) : null}
    </div></div>
  );

  const detailTabs = ledgerTabs.length ? (
    <>
      {/*
        One form, dynamic behaviour. The group is the accounting context, so it
        decides which tabs exist — a bank ledger gets Bank Details, a ledger
        under a TDS group gets TDS Details, and an Indirect Expenses ledger gets
        neither. Statutory, Address and Contact Persons apply to any ledger.
      */}
          <div className="ui-tabs" role="tablist" aria-label="Ledger details">
            {ledgerTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={activeLedgerTab === t.key}
                onClick={() => setLedgerTab(t.key)}
                className={`ui-tab ${activeLedgerTab === t.key ? 'is-active' : ''}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="pt-2">
            {activeLedgerTab === 'bank' ? (
              <>
                <h4 className="ui-t-sec mb-3">Bank Details</h4>
                <div className="grid gap-x-8 gap-y-3 lg:grid-cols-2">
                  <PartyFormRow label="Bank Name" required htmlFor="ledger-bank-name">
                    <input id="ledger-bank-name" value={formData.bankName} onChange={(e) => setFormData((p) => ({ ...p, bankName: e.target.value }))} className="ui-input w-full" />
                  </PartyFormRow>
                  <PartyFormRow label="Account Holder Name" htmlFor="ledger-bank-holder">
                    <input id="ledger-bank-holder" value={formData.bankHolderName} onChange={(e) => setFormData((p) => ({ ...p, bankHolderName: e.target.value }))} className="ui-input w-full" />
                  </PartyFormRow>
                  <PartyFormRow label="Account Number" required htmlFor="ledger-bank-acct">
                    <input id="ledger-bank-acct" value={formData.bankAccountNumber} onChange={(e) => setFormData((p) => ({ ...p, bankAccountNumber: e.target.value }))} className="ui-input ui-mono w-full" />
                  </PartyFormRow>
                  <PartyFormRow label="UPI ID" htmlFor="ledger-bank-upi">
                    <input id="ledger-bank-upi" value={formData.bankUpiId} onChange={(e) => setFormData((p) => ({ ...p, bankUpiId: e.target.value }))} className="ui-input w-full" placeholder="Enter UPI ID (optional)" />
                  </PartyFormRow>
                  <PartyFormRow label="Account Type" htmlFor="ledger-bank-type">
                    <select id="ledger-bank-type" value={formData.bankAccountType} onChange={(e) => setFormData((p) => ({ ...p, bankAccountType: e.target.value }))} className="ui-select w-full">
                      {['Current Account', 'Savings Account', 'Overdraft', 'Cash Credit', 'Other'].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </PartyFormRow>
                  <PartyFormRow label="IFSC Code" required htmlFor="ledger-bank-ifsc" hint="Four letters, a zero, then six characters — HDFC0001234.">
                    <input id="ledger-bank-ifsc" value={formData.bankIfsc} onChange={(e) => setFormData((p) => ({ ...p, bankIfsc: e.target.value.toUpperCase() }))} className="ui-input ui-mono w-full" maxLength={11} />
                  </PartyFormRow>
                  <PartyFormRow label="Branch Address" htmlFor="ledger-bank-braddr">
                    <textarea id="ledger-bank-braddr" rows={3} maxLength={250} value={formData.bankBranchAddress} onChange={(e) => setFormData((p) => ({ ...p, bankBranchAddress: e.target.value }))} className="ui-input w-full" />
                    <p className="ui-caption mt-1 text-right">{String(formData.bankBranchAddress || '').length}/250</p>
                  </PartyFormRow>
                  <PartyFormRow label="Branch Name" htmlFor="ledger-bank-branch">
                    <input id="ledger-bank-branch" value={formData.bankBranch} onChange={(e) => setFormData((p) => ({ ...p, bankBranch: e.target.value }))} className="ui-input w-full" />
                  </PartyFormRow>
                </div>
              </>
            ) : null}

            {activeLedgerTab === 'statutory' ? (
              <>
                <h4 className="ui-t-sec mb-3">Statutory Details</h4>
                <div className="grid gap-x-8 gap-y-3 lg:grid-cols-2">
                <PartyFormRow label="PAN" htmlFor="ledger-pan" hint="Five letters, four digits, one letter — AABCU9603R.">
                  <input id="ledger-pan" value={formData.pan} onChange={(e) => setFormData((p) => ({ ...p, pan: e.target.value.toUpperCase() }))} className="ui-input ui-mono w-full" maxLength={10} />
                </PartyFormRow>
                <PartyFormRow label="GSTIN" htmlFor="ledger-gstin" className="lg:col-span-2">
                  <div className="flex items-center gap-2">
                    <input id="ledger-gstin" value={formData.gstin} onChange={(e) => setFormData((p) => ({ ...p, gstin: e.target.value.toUpperCase() }))} className="ui-input ui-mono min-w-0 flex-1" maxLength={15} placeholder="Enter 15 digit GSTIN" />
                    <button
                      type="button"
                      disabled={gstinFetching}
                      onClick={async () => {
                        const g = String(formData.gstin || '').trim().toUpperCase();
                        if (g.length !== 15) {
                          notify.error('Enter the 15-character GSTIN first.');
                          return;
                        }
                        setGstinFetching(true);
                        try {
                          const data = await lookupGstin(g);
                          setFormData((p) => ({ ...p, gstin: g, pan: p.pan || data?.pan || '' }));
                          notify.success(data?.source === 'derived' ? 'PAN filled from the GSTIN.' : 'Fetched from the GST portal.');
                        } catch (err) {
                          notify.error(String(err?.message || 'Could not fetch that GSTIN.'));
                        } finally {
                          setGstinFetching(false);
                        }
                      }}
                      className="ui-btn ui-btn-secondary shrink-0"
                      style={{ borderColor: 'rgb(var(--brand))', color: 'rgb(var(--brand-ink))' }}
                    >
                      <Search size={14} aria-hidden="true" />
                      {gstinFetching ? 'Fetching…' : 'Fetch from GSTIN'}
                    </button>
                  </div>
                  <p className="ui-caption mt-1">Optional. A bank ledger does not need one — GST registration is not implied by the group.</p>
                </PartyFormRow>
                </div>
              </>
            ) : null}

            {activeLedgerTab === 'tds' ? (
              <>
                <h4 className="ui-t-sec mb-3">TDS Mapping</h4>
                <div className="grid gap-x-8 gap-y-3 lg:grid-cols-2">
                {/*
                  A nature, not a section number.
                  The nature is what a ledger accumulates for ever — CONTRACTOR
                  stays CONTRACTOR whatever the Act renames it — and the
                  section, the rate and the threshold are then whatever the rule
                  in force says they are. Asking for a section here would freeze
                  one year's answer into the ledger master.
                */}
                <PartyFormRow label="TDS Nature" htmlFor="ledger-tds-nature" hint="What this ledger accumulates. The statutory reference and rate follow from the rule in force on each transaction's date.">
                  <select
                    id="ledger-tds-nature"
                    value={formData.tdsNatureCode}
                    onChange={(e) => {
                      const code = e.target.value;
                      const rule = code ? resolveRule(code, todayIso()) : null;
                      setFormData((p) => ({
                        ...p,
                        tdsNatureCode: code,
                        /* Kept in step for rows read by older code paths. */
                        tdsSection: rule?.sectionCode || '',
                        tdsRate: '',
                      }));
                    }}
                    className="ui-select w-full"
                  >
                    <option value="">— none —</option>
                    {TDS_NATURES.filter((n) => n.active !== false).map((n) => (
                      <option key={n.code} value={n.code}>{n.name}</option>
                    ))}
                  </select>
                </PartyFormRow>
                {/* Which side of the books this ledger is — read from the group
                    it was filed under, not asked for twice. */}
                <PartyFormRow label="Side">
                  <div className="ui-input ui-sunken flex items-center">
                    {tdsLedgerNature(groupById.get(String(formData.groupId || '').trim()))}
                  </div>
                </PartyFormRow>
                {/*
                  The ledger is the accounting destination, not the calculator.
                  Thresholds, deductee-type rates and the effective-date rules
                  live in the TDS section master the engine already reads; this
                  only says which section this ledger belongs to. They are shown
                  because somebody configuring the ledger needs to see the rule
                  they are pointing at — and shown read-only, because a second
                  copy of a rate is a second answer.
                */}
                {/*
                  Everything below is the Rule Master's answer, shown so the
                  person mapping the ledger can see the rule they are pointing
                  at — and shown READ-ONLY, because a second copy of a rate,
                  section or threshold is a second answer. Nothing here is
                  typed.
                */}
                {(() => {
                  const activeRule = formData.tdsNatureCode ? resolveRule(formData.tdsNatureCode, todayIso()) : null;
                  const summary = tdsSectionSummary(tdsSection(activeRule?.sectionCode || formData.tdsSection));
                  if (!activeRule) return null;
                  const rows = [
                    ['TDS Rule', String(activeRule.id || '—')],
                    ['Statutory Reference', ruleReference(activeRule) || '—'],
                    ['Default Rate', `${Number(activeRule.rate ?? 0)}%`],
                    ['Threshold', summary?.threshold || '—'],
                  ];
                  return (
                    <dl className="lg:col-span-2 grid gap-x-5 gap-y-1.5 sm:grid-cols-[minmax(8rem,12rem)_1fr]">
                      {rows.map(([k, v]) => (
                        <Fragment key={k}>
                          <dt className="ui-t-label">{k}</dt>
                          <dd className="text-sm">{v}</dd>
                        </Fragment>
                      ))}
                    </dl>
                  );
                })()}

                <PartyFormRow label="Active" htmlFor="ledger-tds-active" hint="Off: the ledger keeps its history and leaves every transaction picker.">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      id="ledger-tds-active"
                      type="checkbox"
                      className="ui-checkbox"
                      checked={formData.isActive !== false}
                      onChange={(e) => setFormData((p) => ({ ...p, isActive: e.target.checked }))}
                    />
                    Available on transactions
                  </label>
                </PartyFormRow>

                <p className="ui-caption lg:col-span-2">
                  {formData.tdsNatureCode
                    ? 'Section, rate and threshold come from the Rule Master and follow each transaction\u2019s date; the engine does the calculation.'
                    : 'Choose the nature this ledger accumulates. The rule, reference and rate resolve from the master.'}
                </p>
                </div>
              </>
            ) : null}

            {activeLedgerTab === 'tcs' ? (
              <p className="ui-caption">
                TCS on the sale of goods under 206C(1H) has not applied since 1 April 2025, so there is nothing to configure
                here. The ledger still accumulates whatever the TCS engine posts to it.
              </p>
            ) : null}

            {activeLedgerTab === 'gst' ? (
              <>
                <h4 className="ui-t-sec mb-3">GST Details</h4>
                <PartyFormRow label="Default GST rate" htmlFor="ledger-gst-rate" hint="Expense booking fills this rate when the ledger is picked.">
                <select
                  id="ledger-gst-rate"
                  value={String(formData.gstRate ?? '')}
                  onChange={(e) => setFormData((p) => ({ ...p, gstRate: e.target.value }))}
                  className="ui-select w-full"
                >
                  <option value="">— none —</option>
                  {[0, 0.25, 3, 5, 12, 18, 28].map((r) => (
                    <option key={r} value={String(r)}>{r}%</option>
                  ))}
                </select>
                </PartyFormRow>
              </>
            ) : null}

            {activeLedgerTab === 'address' ? (
              <AddressTab
                variant="table"
                rows={formData.addresses}
                states={LEDGER_STATES}
                caption="Where this ledger is. Registered office, a branch, wherever a document has to name a place."

                onChange={(i, key, value) => setFormData((p) => ({ ...p, addresses: p.addresses.map((a, j) => (j === i ? { ...a, [key]: value } : a)) }))}
                onAdd={() =>
                  setFormData((p) => ({
                    ...p,
                    addresses: [...(p.addresses || []), { label: p.addresses.length ? `Address ${p.addresses.length + 1}` : 'Registered Office', line1: '', line2: '', city: '', district: '', state: '', pincode: '', country: 'India' }],
                  }))
                }
                onRemove={(i) => setFormData((p) => ({ ...p, addresses: p.addresses.filter((_, j) => j !== i) }))}
              />
            ) : null}

            {activeLedgerTab === 'contacts' ? (
              <ContactsTab
                rows={formData.contacts}
                heading="Contact Persons"
                caption="The people behind this ledger — a relationship manager at the bank, whoever answers about it."

                onChange={(i, key, value) => setFormData((p) => ({ ...p, contacts: p.contacts.map((c, j) => (j === i ? { ...c, [key]: value } : c)) }))}
                onAdd={() => setFormData((p) => ({ ...p, contacts: [...(p.contacts || []), { name: '', position: '', email: '', mobile: '' }] }))}
                onRemove={(i) => setFormData((p) => ({ ...p, contacts: p.contacts.filter((_, j) => j !== i) }))}
              />
            ) : null}
          </div>
    </>
  ) : null;

  return (
    <form onSubmit={handleSubmit} className="customer-create-form ledger-create-form flex min-h-0 flex-col">
      <DocFormActions
        ownCard
        sticky
        title={isEdit ? 'Edit Ledger' : 'New Ledger'}
        onBack={onClose}
        backLabel="Back"
        secondaryLabel="Cancel"
        onSecondary={onClose}
        primaryLabel={isEdit ? 'Save changes' : 'Save'}
        primaryType="submit"
        menu={isEdit ? [] : [{ key: 'saveAndNew', label: 'Save and add another', submit: true, onSelect: () => { saveAndNewRef.current = true; } }]}
      />

      <div className="party-form-layout space-y-3">
        <section className="party-basic-card ui-card p-5 sm:p-6">
          <h3 className="party-section-title ui-t-sec">Basic Details</h3>
          <p className="party-section-copy ui-caption mt-0.5">Enter the primary information about this ledger.</p>
          <div className="party-basic-grid mt-5">{basicDetails}</div>
        </section>

        {detailTabs ? <section className="party-tabs-card ui-card p-5 sm:p-6">{detailTabs}</section> : null}
      </div>
    </form>
  );
};

export const SimpleAccountGroupCreateForm = ({ db, setDb, currentCompany, initialName = '', onCreated, onClose, fullPage = false }) => {
  const groups = useMemo(() => {
    return (Array.isArray(db.accountGroups) ? db.accountGroups : [])
      .filter((g) => g.companyId === currentCompany.id)
      .filter((g) => !g.isLegacy)
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [db.accountGroups, currentCompany.id]);

  const groupOptions = useMemo(() => {
    return groups.map((g) => ({ value: String(g.id), label: String(g.name || '').trim() }));
  }, [groups]);

  const [formData, setFormData] = useState(() => {
    const firstId = groups[0]?.id ? String(groups[0].id) : '';
    return {
      name: String(initialName || '').trim(),
      parentGroupId: firstId,
    };
  });

  // Groups load synchronously from the local store; if they ever appear a
  // render late, adjust during render rather than in an effect.
  if (!formData.parentGroupId && groups[0]?.id) {
    setFormData((p) => ({ ...p, parentGroupId: String(groups[0].id) }));
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const name = String(formData.name || '').trim();
    const parentGroupId = String(formData.parentGroupId || '').trim();

    if (!name) {
      notify.error('Group name is required');
      return;
    }

    if (!parentGroupId) {
      notify.error('Group is required');
      return;
    }

    const parent = groups.find((g) => String(g.id) === parentGroupId) || null;
    if (!parent) {
      notify.error('Please select a valid group.');
      return;
    }

    const clash = groups.some((g) => String(g.name || '').trim().toLowerCase() === name.toLowerCase());
    if (clash) {
      notify.error('Group already exists');
      return;
    }

    const nextId = groups.reduce((m, g) => Math.max(m, Number(g?.id || 0)), 0) + 1;
    const newGroup = {
      id: nextId,
      companyId: currentCompany.id,
      typeId: Number(parent.typeId),
      name,
      parentGroupId: Number(parentGroupId),
      groupCategory: String(parent.groupCategory || 'General').trim() || 'General',
      isUserDefined: true,
      createdAt: new Date().toISOString(),
    };

    // The chart of accounts is the book's own structure. Held in one browser,
    // a group somebody added existed for nobody else and every ledger filed
    // under it landed in a group the next person could not see.
    const serverPatch = await saveMaster('accountGroups', name, {
      typeId: newGroup.typeId,
      parentGroupId: newGroup.parentGroupId,
      groupCategory: newGroup.groupCategory,
      isUserDefined: true,
    });

    setDb({
      ...db,
      accountGroups: [...(Array.isArray(db.accountGroups) ? db.accountGroups : []), { ...newGroup, ...serverPatch }],
    });

    onCreated?.({ ...newGroup, ...serverPatch });
    onClose?.();
  };

  const fields = (
    <div className="space-y-4">
      <div>
        <label className="ui-label" htmlFor="app-group-name">Group Name</label>
        <input id="app-group-name"
          type="text"
          value={formData.name}
          onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
          className="ui-input w-full"
          placeholder="e.g., Bank Charges"
          required
        />
      </div>

      <div>
        <PopupSelect
          label="Group"
          value={formData.parentGroupId}
          onChange={(val) => setFormData((p) => ({ ...p, parentGroupId: String(val || '').trim() }))}
          options={groupOptions}
          placeholder="Select group"
          title="Select Group"
          showValueSubtext={false}
          maxWidthClass="max-w-2xl"
        />
      </div>

      {/* On a screen the bar carries these; in a dialog they are the only
          way out and stay at the foot. */}
      {fullPage ? null : (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onClose?.()} className="px-4 py-2 rounded-lg border ui-hover-sunken">
            Cancel
          </button>
          <button type="submit" className="px-4 py-2 rounded-lg ui-btn ui-btn-primary">
            Create
          </button>
        </div>
      )}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className={fullPage ? '' : 'space-y-4'}>
      {fullPage ? (
        <MasterFormPage
          title="New Group"
          subtitle="A heading in the chart of accounts, and what it rolls up to."
          onBack={onClose}
          primaryLabel="Create"
          heading="Group Details"
          description="The parent decides which statement this group lands on."
        >
          {fields}
        </MasterFormPage>
      ) : (
        fields
      )}
    </form>
  );
};

/**
 * The org id the SERVER knows this company by.
 *
 * The session's `activeOrgId` is also sent by apiFetch as `x-org-id`, so the
 * route parameter must come from that same source. A locally cached company
 * can briefly belong to the previously selected organisation while the new
 * company is hydrating; preferring its backend id makes the URL and header
 * disagree and the server correctly rejects the request as an org mismatch.
 * The company profile remains a cold-start fallback only.
 */
export const resolveServerOrgId = (company) => {
  try {
    const active = String(platformOrgId() || '').trim();
    if (active) return active;
  } catch {
    // Continue to the persisted company fallback below.
  }
  return String(company?.profile?.backendCompanyId || '').trim();
};
