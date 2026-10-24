import { tdsGroupSide } from '@ui/utils/tdsLedgers';
import { useEffect, useMemo, useRef, useState } from 'react';
import { downloadCsvTemplate, parseCsv, readFileText } from '@ui/utils/csv';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { AccountGroupForm } from '../accounts/AccountGroupTypeForms';
import { CustomerForm } from '../../components/pickers/CustomerPicker';
import { VendorForm } from '../../components/pickers/VendorPicker';
import { ChartAccountForm } from '../../appShared';
import { ArrowLeft, BadgePercent, BookOpen, FileText, FolderTree, MoreVertical, Package, Pencil, Plus, Search, Tags, Trash2, Upload } from 'lucide-react';
import { formatMoney } from '@ui/utils/money';
import { EmptyState, TableTotals } from '@ui/components/ui/Primitives';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { useListSearch } from '@ui/components/ListToolbar';
import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { computeInventorySummaryByItemId, isStockItem } from '@ui/utils/inventory';
import ItemForm from './ItemForm';
import { pushMaster, removeMaster, saveMaster } from '@ui/utils/masterSync';

export const ItemsList = ({ db, setDb, currentCompany, warehouses = [], branches = [], onNavigate = null }) => {
  /*
   * The item master takes the screen, the way a document does. `null`, or the
   * item being written — true for a new one.
   */
  const [itemForm, setItemForm] = useState(null);
  const items = db.items.filter((i) => i.companyId === currentCompany.id);
  const itemSearch = useListSearch(items, ['code', 'name', 'hsnSac', 'category', 'barcode']);
  const itemSearchFilters = useColumnFilters();
  const shownItems = itemSearchFilters.applyFilters(itemSearch.filtered, {
    code: (r) => r.code,
    name: (r) => r.name,
    type: (r) => r.type,
    hsn: (r) => r.hsnSac,
    gst: (r) => r.gstRate,
    price: (r) => r.salePrice,
  });
  const inventoryByItemId = useMemo(() => {
    return computeInventorySummaryByItemId({ db, companyId: currentCompany.id });
  }, [db, currentCompany.id]);

  const getItemReferences = (itemId) => {
    const idStr = String(itemId);
    const sources = [
      { key: 'invoices', label: 'Invoice' },
      { key: 'estimates', label: 'Quotation' },
      { key: 'creditNotes', label: 'Credit Note' },
      { key: 'purchaseOrders', label: 'Purchase Order' },
      { key: 'bills', label: 'Bill' },
      { key: 'debitNotes', label: 'Debit Note' },
    ];

    const refs = [];
    for (const src of sources) {
      const docs = Array.isArray(db[src.key]) ? db[src.key] : [];
      for (const doc of docs) {
        if (doc?.companyId !== currentCompany.id) continue;
        const lines = Array.isArray(doc?.items) ? doc.items : [];
        const used = lines.some((l) => String(l?.itemId || '') === idStr);
        if (!used) continue;
        const num = String(doc?.number || '').trim();
        refs.push(`${src.label}${num ? ` ${num}` : ''}`);
      }
    }
    return refs;
  };

  const onEdit = (item) => setItemForm(item);

  const onDelete = async (item) => {
    const refs = getItemReferences(item.id);
    if (refs.length) {
      const preview = refs.slice(0, 5).join(', ');
      notify.error(`Cannot delete this item because it is used in: ${preview}${refs.length > 5 ? '...' : ''}`);
      return;
    }

    const ok = await confirmDialog({ title: 'Please confirm', message: `Delete item "${String(item.name || '').trim() || String(item.code || '').trim() || 'this item'}"?`, confirmLabel: 'Yes, continue' });
    if (!ok) return;

    setDb({
      ...db,
      items: db.items.filter((i) => !(i.companyId === currentCompany.id && i.id === item.id)),
    });
  };

  const [itemFilter, setItemFilter] = useState('ALL');
  const ITEM_TABS = [
    { value: 'ALL', label: 'All', tone: 'all' },
    { value: 'GOODS', label: 'Goods', tone: 'paid' },
    { value: 'SERVICE', label: 'Services', tone: 'sent' },
    { value: 'NOHSN', label: 'No HSN/SAC', tone: 'overdue' },
    { value: 'NOPRICE', label: 'No sale price', tone: 'outstanding' },
  ];
  const itemMatches = (it, tab) => {
    const isService = String(it.type || '').toLowerCase() === 'service';
    if (tab === 'GOODS') return !isService;
    if (tab === 'SERVICE') return isService;
    if (tab === 'NOHSN') return !String(it.hsnSac || '').trim();
    if (tab === 'NOPRICE') return !Number(it.salePrice || 0);
    return true;
  };
  const visibleItems = itemFilter === 'ALL' ? shownItems : shownItems.filter((it) => itemMatches(it, itemFilter));

  const itemStatusCounts = useMemo(() => {
    const counts = { ALL: shownItems.length };
    for (const t of ITEM_TABS) {
      if (t.value === 'ALL') continue;
      counts[t.value] = shownItems.filter((it) => itemMatches(it, t.value)).length;
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownItems]);

  const itemExportColumns = [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'category', label: 'Category' },
    { key: 'hsnSac', label: 'HSN/SAC' },
    { key: 'gstRate', label: 'GST %', value: (r) => Number(r.gstRate || 0) },
    { key: 'salePrice', label: 'Sale Price', value: (r) => Number(r.salePrice || 0) },
    { key: 'purchasePrice', label: 'Purchase Price', value: (r) => Number(r.purchasePrice || 0) },
  ];

  const openNewItem = () => setItemForm(true);

  if (itemForm) {
    return (
      <ItemForm
        fullPage
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        warehouses={warehouses}
        branches={branches}
        onNavigate={onNavigate}
        initialData={itemForm === true ? null : itemForm}
        onClose={() => setItemForm(null)}
      />
    );
  }

  return (
    <DocumentListShell
      entity="items"
      title="Items"
      compact
      tight
      className="item-list-page"
      headerPortalId="master-items-header-slot"
      company={currentCompany}
      search={{
        value: itemSearch.query,
        onChange: itemSearch.setQuery,
        placeholder: 'Search items…',
        label: 'Search items',
      }}
      moreItems={[exportMenuItem('Export items')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Items',
          fileName: `Items_${currentCompany?.name || 'company'}`,
          label: 'item(s)',
          columns: itemExportColumns,
          rows: visibleItems,
        });
      }}
      primary={
        <button type="button" onClick={openNewItem} className="ui-btn ui-btn-primary">
          <Plus size={16} aria-hidden="true" /> New Item
        </button>
      }
      tabs={ITEM_TABS}
      tabsLabel="Item filter"
      statusInHeader
      statusValue={itemFilter}
      statusCounts={itemStatusCounts}
      onStatusChange={setItemFilter}
    >
      <div className="ui-table-scroll item-table-scroll">
        <table className={`ui-table ui-table-wide ui-table-sticky ${visibleItems.length ? '' : 'cash-bank-empty-table'}`}>
          <thead>
            <tr>
              <ColumnHeader label="Code" col="code" state={itemSearchFilters} />
              <ColumnHeader label="Name" col="name" state={itemSearchFilters} />
              <ColumnHeader label="Type" col="type" state={itemSearchFilters} />
              <ColumnHeader label="HSN/SAC" col="hsn" state={itemSearchFilters} />
              <ColumnHeader label="GST %" col="gst" state={itemSearchFilters} className="ui-num" align="right" />
              <ColumnHeader label="Sale price" col="price" state={itemSearchFilters} className="ui-num" align="right" />
              <th scope="col">Stock</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="ui-rows">
            {visibleItems.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    icon={Package}
                    kind="new"
      title={items.length ? 'No items match' : 'No items yet'}
                    description={items.length ? 'No items match the selected filter.' : 'Create an item to get started.'}
                    routes={
                      items.length
                        ? undefined
                        : [
                            {
                              label: 'Add one now',
                              description: 'Name, HSN or SAC, tax rate, price.',
                              onSelect: () => openNewItem(),
                            },
                          ]
                    }
                  />
                </td>
              </tr>
            ) : null}
            {visibleItems.map((item) => (
              <tr key={item.id}>
                <td className="ui-col-id">{item.code}</td>
                <td className="ui-col-entity">{item.name}</td>
                <td className="ui-col-meta">{item.type}</td>
                <td className="ui-col-id">{item.hsnSac || '-'}</td>
                <td className="ui-col-amount ui-mono">{Number.isFinite(Number(item.gstRate)) ? Number(item.gstRate) : 0}</td>
                <td className="ui-col-amount">{formatMoney(item.salePrice || 0, currentCompany)}</td>
                <td className="ui-col-meta">
                  {isStockItem(item) ? (
                    <>
                      {(inventoryByItemId.get(String(item.id))?.closingQty ?? 0)} {item.unit}
                    </>
                  ) : (
                    '-'
                  )}
                </td>
                <td className="px-4 py-2.5 ui-col-meta">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => onEdit(item)}
                      className="px-3 py-1.5 rounded-lg border ui-surface ui-hover-sunken ui-border-c text-sm flex items-center gap-1"
      title="Edit"
                    >
                      <Pencil size={16} /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(item)}
                      className="px-3 py-1.5 rounded-lg border ui-surface ui-hover-sunken ui-border-c text-sm flex items-center gap-1 text-[rgb(var(--neg))]"
      title="Delete"
                    >
                      <Trash2 size={16} /> Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TableTotals count={visibleItems.length} totalCount={items.length} noun="items" />
    </DocumentListShell>
  );
};

export const ChartOfAccounts = ({ db, setDb, openModal, currentCompany, onOpenLedger = null }) => {
  const companyAccountGroups = (Array.isArray(db.accountGroups) ? db.accountGroups : []).filter(
    (group) => group.companyId === currentCompany.id
  );
  const accounts = db.chartOfAccounts.filter(
    (account) =>
      account.companyId === currentCompany.id &&
      (!account.hiddenFromChart || Boolean(tdsGroupSide(companyAccountGroups, account.groupId)))
  );
  const [coaView, setCoaView] = useState('ledgers');
  /*
   * The ledger master opens as a screen, not a dialog.
   *
   * A ledger has five tabs behind it — bank, statutory, TDS, addresses, the
   * people who answer about it — and a dialog gave all of that a scrolling box
   * with the list greyed out behind it. `null`, or the ledger being written.
   */
  const [ledgerForm, setLedgerForm] = useState(null);
  const [openMenu, setOpenMenu] = useState(null);
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groupLedgerSearch, setGroupLedgerSearch] = useState('');
  const menuRef = useRef(null);
  const coaImportInputRef = useRef(null);

  const MENU_WIDTH = 192; // w-48
  const MENU_HEIGHT_ESTIMATE = 120;

  const downloadChartTemplate = () => {
    downloadCsvTemplate({
      fileName: 'Chart_of_Accounts_Import_Template',
      columns: [
        { key: 'Record Type', label: 'Record Type' },
        { key: 'Name', label: 'Name' },
        { key: 'Parent', label: 'Parent' },
        { key: 'Code', label: 'Code' },
        { key: 'Opening Balance', label: 'Opening Balance' },
      ],
      sample: [
        {
          'Record Type': 'GROUP',
          Name: 'Digital Banks',
          Parent: 'Bank Accounts',
          Code: '',
          'Opening Balance': '',
        },
        {
          'Record Type': 'LEDGER',
          Name: 'HDFC Current Account',
          Parent: 'Digital Banks',
          Code: 'BANK-001',
          'Opening Balance': '0',
        },
      ],
    });
    notify.success('Chart of Accounts import template downloaded. Use GROUP or LEDGER in Record Type.');
  };

  const exportChart = (format) => {
    const groups = accountGroups.map((group) => ({
      recordType: 'GROUP',
      name: group.name,
      parent:
        accountGroups.find((parent) => String(parent.id) === String(group.parentGroupId))?.name ||
        typeById.get(String(group.typeId))?.name ||
        '',
      code: '',
      openingBalance: '',
    }));
    const ledgers = accounts.map((account) => ({
      recordType: 'LEDGER',
      name: account.name,
      parent: groupById.get(String(account.groupId))?.name || '',
      code: account.code || '',
      openingBalance: Number(account.openingBalance || 0),
    }));
    runListExport({
      format,
      title: 'Chart of Accounts',
      fileName: `Chart_of_Accounts_${currentCompany?.name || 'company'}`,
      label: 'account row(s)',
      columns: [
        { key: 'recordType', label: 'Record Type' },
        { key: 'name', label: 'Name' },
        { key: 'parent', label: 'Parent' },
        { key: 'code', label: 'Code' },
        { key: 'openingBalance', label: 'Opening Balance' },
      ],
      rows: [...groups, ...ledgers],
    });
  };

  const importChart = async (file) => {
    try {
      const { rows } = parseCsv(await readFileText(file));
      if (!rows.length) return notify.error('That file has no data rows.');

      const nextGroups = [...(Array.isArray(db.accountGroups) ? db.accountGroups : [])];
      const nextAccounts = [...(Array.isArray(db.chartOfAccounts) ? db.chartOfAccounts : [])];
      const companyTypes = (Array.isArray(db.accountTypes) ? db.accountTypes : []).filter(
        (type) => type.companyId === currentCompany.id && !type.isLegacy
      );
      let nextGroupId = nextGroups.reduce((max, row) => Math.max(max, Number(row?.id || 0)), 0) + 1;
      let nextAccountId = nextAccounts.reduce((max, row) => Math.max(max, Number(row?.id || 0)), 0) + 1;
      const problems = [];
      let createdGroups = 0;
      let createdLedgers = 0;
      const lower = (value) => String(value || '').trim().toLowerCase();
      const findGroup = (name) => nextGroups.find(
        (group) => group.companyId === currentCompany.id && !group.isLegacy && lower(group.name) === lower(name)
      );
      const findType = (name) => companyTypes.find((type) => lower(type.name) === lower(name));

      for (const [index, row] of rows.entries()) {
        if (lower(row['Record Type']) !== 'group') continue;
        const name = String(row.Name || '').trim();
        const parentName = String(row.Parent || '').trim();
        if (!name || !parentName) {
          problems.push(`Row ${index + 2}: group Name and Parent are required.`);
          continue;
        }
        if (findGroup(name)) continue;
        const parentGroup = findGroup(parentName);
        const parentType = findType(parentName);
        if (!parentGroup && !parentType) {
          problems.push(`Row ${index + 2}: parent “${parentName}” was not found.`);
          continue;
        }
        nextGroups.push({
          id: nextGroupId++,
          companyId: currentCompany.id,
          typeId: Number(parentGroup?.typeId ?? parentType.id),
          name,
          parentGroupId: parentGroup?.id ?? null,
          groupCategory: String(parentGroup?.groupCategory || 'General').trim() || 'General',
          isUserDefined: true,
          createdAt: new Date().toISOString(),
        });
        createdGroups += 1;
      }

      for (const [index, row] of rows.entries()) {
        if (lower(row['Record Type']) !== 'ledger') continue;
        const name = String(row.Name || '').trim();
        const parentName = String(row.Parent || '').trim();
        const parent = findGroup(parentName);
        if (!name || !parent) {
          problems.push(`Row ${index + 2}: ledger Name and a valid Parent group are required.`);
          continue;
        }
        const duplicate = nextAccounts.some(
          (account) => account.companyId === currentCompany.id && !account.hiddenFromChart && lower(account.name) === lower(name)
        );
        if (duplicate) continue;
        const type = companyTypes.find((item) => String(item.id) === String(parent.typeId));
        const openingBalance = String(type?.main || '').trim() === 'P&L' ? 0 : (Number(row['Opening Balance'] || 0) || 0);
        nextAccounts.push({
          id: nextAccountId++,
          companyId: currentCompany.id,
          code: String(row.Code || '').trim(),
          name,
          groupId: parent.id,
          ledgerCategory: String(parent.groupCategory || 'General').trim() || 'General',
          type: String(type?.accountClass || 'Asset'),
          subType: String(type?.name || ''),
          main: String(type?.main || 'Balance Sheet'),
          openingBalance,
          balance: openingBalance,
          isUserDefined: true,
          hiddenFromChart: false,
          createdAt: new Date().toISOString(),
        });
        createdLedgers += 1;
      }

      if (!createdGroups && !createdLedgers) {
        return notify.error(problems[0] || 'No new groups or ledgers were found in the file.');
      }
      setDb({ ...db, accountGroups: nextGroups, chartOfAccounts: nextAccounts });
      notify.success(`Imported ${createdGroups} group(s) and ${createdLedgers} ledger(s).${problems.length ? ` ${problems.length} row(s) skipped.` : ''}`);
    } catch (error) {
      notify.error(error?.message || 'Unable to import the Chart of Accounts file.');
    }
  };

  const LedgerCreateChooser = ({ onClose }) => {
    /*
     * Every door out of the chooser opens a screen.
     *
     * A customer and a vendor are masters with five tabs behind them, the same
     * as a ledger. In a dialog the form's own bar sat under the dialog's title
     * — two headings saying "New Customer" — and the tabs scrolled inside a box
     * with the list greyed out behind it.
     */
    const openCustomerCreate = () => {
      openModal(null);
      setLedgerForm({ mode: 'newCustomer' });
    };

    const openVendorCreate = () => {
      openModal(null);
      setLedgerForm({ mode: 'newVendor' });
    };

    const openOtherLedgerCreate = () => {
      openModal(null);
      setLedgerForm({ mode: 'new' });
    };

    return (
      <div className="space-y-6">
        <div className="text-sm ui-muted">Choose what you want to create:</div>

        <div className="grid grid-cols-1 gap-3">
          <button
            type="button"
            onClick={openVendorCreate}
            className="w-full text-left px-4 py-3 rounded-lg border ui-surface ui-hover-sunken ui-border-c"
          >
            <div className="font-semibold">1. Vendor</div>
            <div className="text-xs ui-muted">Opens vendor creation form</div>
          </button>

          <button
            type="button"
            onClick={openCustomerCreate}
            className="w-full text-left px-4 py-3 rounded-lg border ui-surface ui-hover-sunken ui-border-c"
          >
            <div className="font-semibold">2. Customer</div>
            <div className="text-xs ui-muted">Opens customer creation form</div>
          </button>

          <button
            type="button"
            onClick={openOtherLedgerCreate}
            className="w-full text-left px-4 py-3 rounded-lg border ui-surface ui-hover-sunken ui-border-c"
          >
            <div className="font-semibold">3. Others</div>
            <div className="text-xs ui-muted">Create any ledger other than Vendor/Customer ledgers</div>
          </button>
        </div>

        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border ui-hover-sunken">
            Cancel
          </button>
        </div>
      </div>
    );
  };

  const accountTypes = (Array.isArray(db.accountTypes) ? db.accountTypes : [])
    .filter((t) => t.companyId === currentCompany.id)
    .filter((t) => !t.isLegacy)
    .slice()
    .sort((a, b) => {
      const am = String(a.main || '');
      const bm = String(b.main || '');
      if (am !== bm) return am.localeCompare(bm);
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

  const accountGroups = (Array.isArray(db.accountGroups) ? db.accountGroups : [])
    .filter((g) => g.companyId === currentCompany.id)
    .filter((g) => !g.isLegacy)
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const typeById = useMemo(() => {
    const m = new Map();
    for (const t of accountTypes) m.set(String(t.id), t);
    return m;
  }, [accountTypes]);

  const groupById = useMemo(() => {
    const m = new Map();
    for (const g of accountGroups) m.set(String(g.id), g);
    return m;
  }, [accountGroups]);

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

  useEffect(() => {
    if (!openMenu?.id) return;

    const onMouseDown = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      const btn = e.target?.closest?.('[data-coa-menu-button]');
      if (btn && String(btn.getAttribute('data-coa-menu-button')) === String(openMenu.buttonKey)) return;
      setOpenMenu(null);
    };

    const onScrollOrResize = () => setOpenMenu(null);

    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);

    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [openMenu?.id]);

  const openRowMenu = (kind, id, anchorEl) => {
    const buttonKey = `${String(kind)}:${String(id)}`;

    setOpenMenu({ kind, id, buttonKey, left: 0, top: 0 });
    const rect = anchorEl?.getBoundingClientRect?.();
    if (!rect) return;

    const leftPref = rect.right - MENU_WIDTH;
    const left = Math.max(8, Math.min(leftPref, window.innerWidth - MENU_WIDTH - 8));

    const topPref = rect.bottom + 8;
    const top = Math.max(8, Math.min(topPref, window.innerHeight - MENU_HEIGHT_ESTIMATE - 8));

    setOpenMenu({ kind, id, buttonKey, left, top });
  };

  const ledgerRows = useMemo(() => {
    return accounts
      .map((a) => {
        const group = a?.groupId ? groupById.get(String(a.groupId)) : null;
        const typeRow = group ? typeById.get(String(group.typeId)) : null;
        return {
          ...a,
          _groupName: group?.name || '',
          _parent: typeRow
            ? typeRowToParent(typeRow)
            : String(a.main || '').trim() === 'P&L'
              ? (String(a.type || '').trim() === 'Expense' ? 'Expenses' : 'Income')
              : String(a.type || '').trim() === 'Liability' || String(a.type || '').trim() === 'Equity'
                ? 'Liabilities'
                : 'Assets',
        };
      })
      .sort((x, y) => {
        const pa = String(x._parent || '');
        const pb = String(y._parent || '');
        if (pa !== pb) return pa.localeCompare(pb);
        const ga = String(x._groupName || '');
        const gb = String(y._groupName || '');
        if (ga !== gb) return ga.localeCompare(gb);
        return String(x.name || '').localeCompare(String(y.name || ''));
      });
  }, [accounts, groupById, typeById]);

  const visibleLedgerRows = useMemo(() => {
    const q = String(ledgerSearch || '').trim().toLowerCase();
    if (!q) return ledgerRows;
    return ledgerRows.filter((a) => {
      const hay = `${String(a?.name || '')} ${String(a?.code || '')} ${String(a?._groupName || '')} ${String(a?._parent || '')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [ledgerRows, ledgerSearch]);

  const groupRows = useMemo(() => {
    return accountGroups
      .map((g) => {
        const typeRow = g?.typeId ? typeById.get(String(g.typeId)) : null;
        return {
          ...g,
          _parent: groupById.get(String(g.parentGroupId))?.name || (typeRow ? typeRowToParent(typeRow) : '-'),
        };
      })
      .sort((a, b) => {
        const pa = String(a._parent || '');
        const pb = String(b._parent || '');
        if (pa !== pb) return pa.localeCompare(pb);
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
  }, [accountGroups, groupById, typeById]);

  const visibleGroupRows = useMemo(() => {
    const q = String(groupSearch || '').trim().toLowerCase();
    if (!q) return groupRows;
    return groupRows.filter((g) => {
      const hay = `${String(g?.name || '')} ${String(g?._parent || '')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [groupRows, groupSearch]);

  const selectedGroup = groupRows.find((group) => String(group.id) === String(selectedGroupId)) || null;
  const selectedGroupLedgerRows = useMemo(() => {
    if (!selectedGroupId) return [];
    const included = new Set([String(selectedGroupId)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const group of accountGroups) {
        if (included.has(String(group.parentGroupId || '')) && !included.has(String(group.id))) {
          included.add(String(group.id));
          changed = true;
        }
      }
    }
    const query = String(groupLedgerSearch || '').trim().toLowerCase();
    return ledgerRows.filter((ledger) => {
      if (!included.has(String(ledger.groupId || ''))) return false;
      if (!query) return true;
      return `${ledger.name || ''} ${ledger.code || ''} ${ledger._groupName || ''}`.toLowerCase().includes(query);
    });
  }, [selectedGroupId, groupLedgerSearch, accountGroups, ledgerRows]);

  const openNewLedger = () => {
    openModal(<LedgerCreateChooser onClose={() => openModal(null)} />, { title: 'Create', maxWidthClass: 'max-w-lg' });
  };

  const openNewGroup = () => setLedgerForm({ mode: 'newGroup' });

  const openEditLedger = (ledger) => setLedgerForm({ mode: 'edit', ledger });

  const openEditGroup = (group) => {
    if (group?.isSystem) {
      notify.error('Default ledger groups cannot be edited.');
      return;
    }
    setLedgerForm({ mode: 'editGroup', group });
  };

  const canDeleteLedger = (ledgerId) => {
    const id = String(ledgerId || '').trim();
    if (!id) return { ok: false, reason: 'Invalid ledger.' };

    const ledger = accounts.find((account) => String(account?.id) === id);
    if (ledger?.isSystem) return { ok: false, reason: 'Default ledgers cannot be deleted.' };

    const usedInJournal = (Array.isArray(db.journalEntries) ? db.journalEntries : [])
      .filter((j) => j.companyId === currentCompany.id)
      .some((j) => (Array.isArray(j.lines) ? j.lines : []).some((l) => String(l?.accountId || '').trim() === id));
    if (usedInJournal) return { ok: false, reason: 'Ledger is used in Journal Entries.' };

    const linkedCustomer = (Array.isArray(db.customers) ? db.customers : [])
      .filter((c) => c.companyId === currentCompany.id)
      .some((c) => String(c?.accountId || '').trim() === id);
    if (linkedCustomer) return { ok: false, reason: 'Ledger is linked to a Customer.' };

    const linkedVendor = (Array.isArray(db.vendors) ? db.vendors : [])
      .filter((v) => v.companyId === currentCompany.id)
      .some((v) => String(v?.accountId || '').trim() === id);
    if (linkedVendor) return { ok: false, reason: 'Ledger is linked to a Vendor.' };

    return { ok: true, reason: '' };
  };

  const deleteLedger = async (ledger) => {
    const check = canDeleteLedger(ledger?.id);
    if (!check.ok) {
      notify.error(check.reason === 'Default ledgers cannot be deleted.' ? check.reason : `Cannot delete this ledger. ${check.reason}`);
      return;
    }

    const ok = await confirmDialog({ title: 'Please confirm', message: `Delete ledger "${String(ledger?.name || '').trim() || 'this ledger'}"?`, confirmLabel: 'Yes, continue' });
    if (!ok) return;

    setDb({
      ...db,
      chartOfAccounts: (Array.isArray(db.chartOfAccounts) ? db.chartOfAccounts : []).filter(
        (a) => !(a.companyId === currentCompany.id && String(a.id) === String(ledger.id))
      ),
    });
  };

  /*
   * A ledger that has been posted to cannot be deleted — the entries would
   * point at nothing. Retiring it is the answer the spec gives: it keeps its
   * history and its balance on the reports, and stops being offered for new
   * entries. Nothing is lost and nothing else has to be corrected.
   */
  const setLedgerActive = (ledger, active) => {
    setDb({
      ...db,
      chartOfAccounts: (Array.isArray(db.chartOfAccounts) ? db.chartOfAccounts : []).map((a) =>
        a.companyId === currentCompany.id && String(a.id) === String(ledger.id) ? { ...a, active } : a
      ),
    });
    notify.success(active ? `"${ledger.name}" is active again.` : `"${ledger.name}" will not be offered for new entries.`);
  };

  const canDeleteGroup = (groupId) => {
    const id = String(groupId || '').trim();
    if (!id) return { ok: false, reason: 'Invalid group.' };

    const usedByChildGroup = accountGroups.some(
      (g) => String(g?.parentGroupId || '').trim() === id
    );
    if (usedByChildGroup) return { ok: false, reason: 'Group contains one or more child groups.' };

    const usedByLedger = accounts.some((a) => String(a?.groupId || '').trim() === id);
    if (usedByLedger) return { ok: false, reason: 'Group is used by one or more ledgers.' };

    return { ok: true, reason: '' };
  };

  const deleteGroup = async (group) => {
    if (group?.isSystem) {
      notify.error('Default ledger groups cannot be deleted.');
      return;
    }
    const check = canDeleteGroup(group?.id);
    if (!check.ok) {
      notify.error(`Cannot delete this group. ${check.reason}`);
      return;
    }

    const ok = await confirmDialog({ title: 'Please confirm', message: `Delete group "${String(group?.name || '').trim() || 'this group'}"?`, confirmLabel: 'Yes, continue' });
    if (!ok) return;

    const deletedDefaults = new Set(
      Array.isArray(currentCompany?.docSettings?.deletedDefaultAccountGroups)
        ? currentCompany.docSettings.deletedDefaultAccountGroups.map((name) => String(name || '').trim().toLowerCase())
        : []
    );
    if (group?.isSystem) deletedDefaults.add(String(group?.name || '').trim().toLowerCase());
    const companies = (Array.isArray(db.companies) ? db.companies : []).map((company) =>
      company.id === currentCompany.id
        ? {
            ...company,
            docSettings: {
              ...(company.docSettings || {}),
              deletedDefaultAccountGroups: [...deletedDefaults],
            },
          }
        : company
    );

    setDb({
      ...db,
      companies,
      accountGroups: (Array.isArray(db.accountGroups) ? db.accountGroups : []).filter(
        (g) => !(g.companyId === currentCompany.id && String(g.id) === String(group.id))
      ),
    });
  };

  /*
   * The form takes the screen, the way the customer and vendor masters do. Back
   * and Cancel in its own bar return here; there is no dialog to dismiss.
   */
  if (ledgerForm?.mode === 'editGroup') {
    return (
      <AccountGroupForm
        fullPage
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        initialData={ledgerForm.group}
        onClose={() => setLedgerForm(null)}
      />
    );
  }

  if (ledgerForm?.mode === 'newGroup') {
    return (
      <AccountGroupForm
        fullPage
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        onClose={() => setLedgerForm(null)}
      />
    );
  }

  if (ledgerForm?.mode === 'newCustomer' || ledgerForm?.mode === 'newVendor') {
    const PartyForm = ledgerForm.mode === 'newCustomer' ? CustomerForm : VendorForm;
    return (
      <div className="space-y-6">
        <PartyForm db={db} setDb={setDb} currentCompany={currentCompany} onClose={() => setLedgerForm(null)} />
      </div>
    );
  }

  if (ledgerForm) {
    return (
      <div className="space-y-6">
        <ChartAccountForm
          fullPage
          db={db}
          setDb={setDb}
          currentCompany={currentCompany}
          openModal={openModal}
          initialData={ledgerForm.mode === 'edit' ? ledgerForm.ledger : null}
          excludeGroupCategories={ledgerForm.mode === 'edit' ? [] : ['Customer', 'Vendor']}
          onClose={() => setLedgerForm(null)}
        />
      </div>
    );
  }

  if (selectedGroup) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              onClick={() => {
                setOpenMenu(null);
                setSelectedGroupId('');
                setGroupLedgerSearch('');
              }}
            >
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
            <div className="min-w-0">
              <h1 className="ui-t-page">{selectedGroup.name}</h1>
              <p className="ui-muted ui-t-body mt-1">
                {selectedGroupLedgerRows.length} ledger{selectedGroupLedgerRows.length === 1 ? '' : 's'} under this group
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="relative">
              <Search size={16} className="ui-muted pointer-events-none absolute start-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                className="ui-input w-64 ps-9"
                value={groupLedgerSearch}
                onChange={(event) => setGroupLedgerSearch(event.target.value)}
                placeholder="Search ledgers…"
                aria-label="Search ledgers in group"
              />
            </div>
            <button type="button" className="ui-btn ui-btn-primary" onClick={openNewLedger}>
              <Plus size={16} aria-hidden="true" /> New Ledger
            </button>
          </div>
        </div>

        <div className="ui-card overflow-hidden">
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-wide ui-table-sticky coa-table">
              <thead>
                <tr>
                  <th scope="col">Ledger</th>
                  <th scope="col">Code</th>
                  <th scope="col">Group</th>
                  <th scope="col" className="text-right">Opening Balance</th>
                  <th scope="col" className="text-right">Action</th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {selectedGroupLedgerRows.length ? selectedGroupLedgerRows.map((ledger) => (
                  <tr key={ledger.id}>
                    <td className="ui-col-entity">
                      <button
                        type="button"
                        className="font-semibold text-left text-[rgb(var(--brand))] hover:underline"
                        onClick={() => onOpenLedger?.(String(ledger.id))}
                      >
                        {ledger.name}
                      </button>
                      {ledger.active === false ? <span className="ui-chip ml-2">Inactive</span> : null}
                    </td>
                    <td className="ui-col-meta ui-mono">{ledger.code || '—'}</td>
                    <td className="ui-col-meta ui-fg">{ledger._groupName || selectedGroup.name}</td>
                    <td className="ui-col-amount text-right">{formatMoney(Number(ledger.openingBalance || 0), currentCompany)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="ui-icon-btn"
                        aria-label={`Edit ${ledger.name}`}
                        onClick={() => openEditLedger(ledger)}
                      >
                        <MoreVertical size={18} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan="5">
                      <EmptyState
                        icon={BookOpen}
                        kind="new"
                        title={groupLedgerSearch ? 'No ledgers match' : 'No ledgers in this group'}
                        description={groupLedgerSearch ? 'Try another ledger name or code.' : 'Create a ledger and assign it to this group.'}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <DocumentListShell
      entity="chartOfAccounts"
      title="Chart of Accounts"
      className="coa-list-page"
      company={currentCompany}
      search={
        coaView === 'ledgers'
          ? { value: ledgerSearch, onChange: setLedgerSearch, placeholder: 'Search ledgers…', label: 'Search ledgers' }
          : { value: groupSearch, onChange: setGroupSearch, placeholder: 'Search groups…', label: 'Search groups' }
      }
      moreItems={[
        { key: 'coa-import', label: 'Import Chart of Accounts', Icon: Upload },
        { key: 'coa-template', label: 'Download import template', Icon: FileText },
        exportMenuItem('Export Chart of Accounts'),
      ]}
      onMoreSelect={(k) => {
        if (k === 'coa-import') {
          coaImportInputRef.current?.click();
          return;
        }
        if (k === 'coa-template') {
          downloadChartTemplate();
          return;
        }
        const format = exportFormatFromKey(k);
        if (!format) return;
        exportChart(format);
      }}
      primary={
        coaView === 'ledgers' ? (
          <button type="button" onClick={openNewLedger} className="ui-btn ui-btn-primary">
            <Plus size={16} aria-hidden="true" /> New Ledger
          </button>
        ) : (
          <button type="button" onClick={openNewGroup} className="ui-btn ui-btn-primary">
            <Plus size={16} aria-hidden="true" /> New Group
          </button>
        )
      }
      tabs={[
        { value: 'ledgers', label: 'Ledgers', tone: 'all' },
        { value: 'groups', label: 'Groups', tone: 'sent' },
      ]}
      tabsLabel="Chart of Accounts view"
      statusInHeader
      statusValue={coaView}
      statusCounts={{ ledgers: ledgerRows.length, groups: groupRows.length }}
      onStatusChange={(value) => {
        setOpenMenu(null);
        setCoaView(value);
      }}
      above={
        <input
          ref={coaImportInputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0] || null;
            event.target.value = '';
            if (file) importChart(file);
          }}
        />
      }
      tip={{
        storageKey: 'clor.tip.chartOfAccounts',
        Icon: BookOpen,
        text: 'A ledger belongs to a group, and the group decides which statement it lands on — the chart is what makes the reports add up.',
      }}
    >
      <div className="coa-list-body">
        {coaView === 'ledgers' ? (
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-wide ui-table-sticky coa-table">
              <colgroup>
                <col style={{ width: '40%' }} />
                <col style={{ width: '30%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '8%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Ledger</th>
                  <th scope="col">Group</th>
                  <th scope="col">Parent</th>
                  <th scope="col" className="text-right">Action</th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {visibleLedgerRows.length === 0 ? (
                  <tr>
                    <td colSpan="4">
                      <EmptyState
                        icon={BookOpen}
                        kind="new"
      title={ledgerRows.length ? 'No ledgers match' : 'No ledgers yet'}
                        description={
                          ledgerRows.length
                            ? 'Nothing in this chart matches that search.'
                            : 'A ledger is what a posting lands in. Setting up the company creates the usual ones; add the rest as you need them.'
                        }
                        routes={
                          ledgerRows.length
                            ? undefined
                            : [
                                {
                                  label: 'Add a ledger',
                                  description: 'Name it and put it in the group it reports under.',
                                  onSelect: () => openNewLedger(),
                                },
                              ]
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  visibleLedgerRows.map((a) => {
                    const buttonKey = `ledger:${String(a.id)}`;
                    return (
                      <tr key={a.id}>
                        <td className="ui-col-entity">
                          <button
                            type="button"
                            onClick={() => onOpenLedger?.(String(a.id))}
                            className="font-semibold text-left text-[rgb(var(--brand-ink))] hover:underline"
                          >
                            {a.name}
                          </button>
                          {a.active === false ? <span className="ui-chip ml-2">Inactive</span> : null}
                        </td>
                        <td className="ui-col-meta ui-fg">{a._groupName || '-'}</td>
                        <td className="ui-col-meta ui-fg">{a._parent || '-'}</td>
                        <td
                          className="text-right"
                          onMouseDown={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (openMenu?.buttonKey === buttonKey) {
                                setOpenMenu(null);
                              } else {
                                openRowMenu('ledger', a.id, e.currentTarget);
                              }
                            }}
                            className="coa-action-btn ui-hover-sunken inline-flex"
                            aria-label="Ledger actions"
                            data-coa-menu-button={buttonKey}
                          >
                            <MoreVertical size={18} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-wide ui-table-sticky coa-table">
              <colgroup>
                <col style={{ width: '48%' }} />
                <col style={{ width: '44%' }} />
                <col style={{ width: '8%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">Parent</th>
                  <th scope="col" className="text-right">Action</th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {visibleGroupRows.length === 0 ? (
                  <tr>
                    <td colSpan="3">
                      <EmptyState
                        icon={FolderTree}
                        kind="new"
      title={groupRows.length ? 'No groups match' : 'No groups yet'}
                        description={
                          groupRows.length
                            ? 'Nothing in this chart matches that search.'
                            : 'A group decides which statement its ledgers land on — Sundry Debtors on the balance sheet, Indirect Expenses on the P&L.'
                        }
                        routes={
                          groupRows.length
                            ? undefined
                            : [
                                {
                                  label: 'Add a group',
                                  description: 'Name it and say which parent it rolls up to.',
                                  onSelect: () => openNewGroup(),
                                },
                              ]
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  visibleGroupRows.map((g) => {
                    const buttonKey = `group:${String(g.id)}`;
                    return (
                      <tr key={g.id}>
                        <td className="ui-col-entity">
                          <button
                            type="button"
                            className="font-semibold text-left text-[rgb(var(--brand))] hover:underline"
                            onClick={() => {
                              setOpenMenu(null);
                              setSelectedGroupId(String(g.id));
                              setGroupLedgerSearch('');
                            }}
                          >
                            {g.name}
                          </button>
                        </td>
                        <td className="ui-col-meta ui-fg">{g._parent || '-'}</td>
                        <td
                          className="text-right"
                          onMouseDown={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {g.isSystem ? (
                            <span className="ui-chip">Default</span>
                          ) : (
                            <button
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (openMenu?.buttonKey === buttonKey) {
                                  setOpenMenu(null);
                                } else {
                                  openRowMenu('group', g.id, e.currentTarget);
                                }
                              }}
                              className="coa-action-btn ui-hover-sunken inline-flex"
                              aria-label="Group actions"
                              data-coa-menu-button={buttonKey}
                            >
                              <MoreVertical size={18} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openMenu?.id ? (
        <div
          ref={menuRef}
          className="fixed w-48 ui-surface border ui-border-c rounded-xl shadow-lg overflow-hidden"
          style={{ left: openMenu.left, top: openMenu.top, zIndex: 'var(--z-popover)' }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          data-coa-menu
        >
          {(() => {
            if (openMenu.kind === 'ledger') {
              const ledger = ledgerRows.find((x) => String(x.id) === String(openMenu.id));
              if (!ledger) return null;
              return (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      openEditLedger(ledger);
                    }}
                    className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                  >
                    <span className="ui-muted">Edit</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      setLedgerActive(ledger, ledger.active === false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                  >
                    <span>{ledger.active === false ? 'Reactivate' : 'Make inactive'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      deleteLedger(ledger);
                    }}
                    className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2 text-[rgb(var(--neg))]"
                  >
                    <span>Delete</span>
                  </button>
                </>
              );
            }

            const group = groupRows.find((x) => String(x.id) === String(openMenu.id));
            if (!group) return null;

            if (group.isSystem) return null;

            const editDisabled = false;
            const canDel = canDeleteGroup(group?.id);
            const deleteDisabled = !canDel.ok;

            return (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    openEditGroup(group);
                  }}
                  disabled={editDisabled}
                  className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${ editDisabled ? 'ui-subtle cursor-not-allowed ui-surface' : 'ui-hover-sunken'
                  }`}
                >
                  <span>Edit</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    deleteGroup(group);
                  }}
                  disabled={deleteDisabled}
                  className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${ deleteDisabled ? 'ui-subtle cursor-not-allowed ui-surface' : 'ui-hover-sunken text-[rgb(var(--neg))]'
                  }`}
      title={deleteDisabled ? canDel.reason : ''}
                >
                  <span>Delete</span>
                </button>
              </>
            );
          })()}
        </div>
      ) : null}
    </DocumentListShell>
  );
};

export const UomsList = ({ db, setDb, currentCompany }) => {
  const uoms = (db.uoms || [])
    .filter((u) => u.companyId === currentCompany.id)
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const [newUom, setNewUom] = useState('');
  const uomSearch = useListSearch(uoms, ['name']);
  const visibleUoms = uomSearch.filtered;

  const addUom = async () => {
    const name = String(newUom || '').trim();
    if (!name) {
      notify.error('Please enter a UoM name.');
      return;
    }

    const exists = uoms.some((u) => String(u.name || '').trim().toLowerCase() === name.toLowerCase());
    if (exists) {
      notify.error('This UoM already exists.');
      return;
    }

    const nextId = Math.max(0, ...(db.uoms || []).map((u) => Number(u.id) || 0)) + 1;
    // Every item carries a unit, so a unit list held in one browser meant a
    // second person could not enter the item at all.
    const serverPatch = await saveMaster('uoms', name);
    const next = { id: nextId, companyId: currentCompany.id, name, ...serverPatch };

    setDb({
      ...db,
      uoms: [...(db.uoms || []), next],
    });
    setNewUom('');
  };

  const deleteUom = async (id) => {
    const row = (db.uoms || []).find((u) => u.id === id);
    if (row) await removeMaster(row);
    setDb({
      ...db,
      uoms: (db.uoms || []).filter((u) => u.id !== id),
    });
  };

  return (
    <DocumentListShell
      entity="items"
      title="Units of Measure"
      compact
      tight
      className="master-item-list-page"
      headerPortalId="master-uoms-header-slot"
      company={currentCompany}
      search={{ value: uomSearch.query, onChange: uomSearch.setQuery, placeholder: 'Search units…', label: 'Search units' }}
      headerExtras={
        <input
          type="text"
          value={newUom}
          onChange={(e) => setNewUom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addUom(); }}
          className="ui-input ui-ctl-compact w-48"
          aria-label="Unit name"
          placeholder="New unit, e.g. Pcs"
        />
      }
      primary={<button type="button" onClick={addUom} className="ui-btn ui-btn-primary"><Plus size={15} /> Add unit</button>}
    >
        <div className="ui-table-scroll master-item-table-scroll">
          <table className={`ui-table ui-table-wide ui-table-sticky w-full ${visibleUoms.length ? '' : 'cash-bank-empty-table'}`}>
            <thead>
              <tr>
                <th>Unit</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {visibleUoms.length === 0 ? (
                <tr>
                  <td colSpan="2" className="px-6 py-10 text-center ui-muted">
                    {uoms.length ? 'No units match' : 'No units yet'}
                  </td>
                </tr>
              ) : (
                visibleUoms.map((u) => (
                  <tr key={u.id} className="ui-hover-sunken">
                    <td className="px-4 py-2.5 ui-col-entity">{u.name}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button type="button" onClick={() => deleteUom(u.id)} aria-label={`Delete unit ${u.name}`} title="Delete" className="text-[rgb(var(--neg))] hover:text-[rgb(var(--neg))]">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

    </DocumentListShell>
  );
};

/**
 * Item categories — the master behind the Category field on an item.
 *
 * Categories used to be typed free-hand on each item, so the same shelf could
 * be spelled three ways and a category-level discount would miss two of them.
 * They live here now; the item form picks from this list (and can add to it).
 * Categories already typed on items are imported once, so nothing is lost.
 */
export const ItemCategoriesList = ({ db, setDb, currentCompany }) => {
  const categories = (db.itemCategories || [])
    .filter((c) => c.companyId === currentCompany.id)
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const items = (db.items || []).filter((i) => i.companyId === currentCompany.id);

  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null); // { id, name, description }

  const catSearch = useListSearch(categories, ['name', 'description']);
  const catFilters = useColumnFilters();

  const countFor = (name) => {
    const key = String(name || '').trim().toLowerCase();
    return items.filter((i) => String(i.category || '').trim().toLowerCase() === key).length;
  };

  const rows = catFilters.apply(catSearch.filtered, {
    name: (c) => c.name,
    description: (c) => c.description || '',
    items: (c) => countFor(c.name),
  });

  // One-time import of whatever was already typed on items.
  const orphans = [
    ...new Set(
      items
        .map((i) => String(i.category || '').trim())
        .filter(Boolean)
        .filter((name) => !categories.some((c) => String(c.name || '').trim().toLowerCase() === name.toLowerCase()))
    ),
  ];

  const importOrphans = () => {
    if (!orphans.length) return;
    let nextId = Math.max(0, ...(db.itemCategories || []).map((c) => Number(c.id) || 0));
    const added = orphans.map((name) => ({ id: ++nextId, companyId: currentCompany.id, name, description: '' }));
    // Written one at a time: a name that clashes on the server is refused on
    // its own rather than taking the whole import down with it.
    Promise.all(added.map((c) => saveMaster('itemCategories', c.name, { description: '' }))).then((patches) =>
      setDb((prev) => ({
        ...prev,
        itemCategories: (prev.itemCategories || []).map((c) => {
          const at = added.findIndex((a) => a.id === c.id);
          return at === -1 ? c : { ...c, ...patches[at] };
        }),
      }))
    );
    setDb({ ...db, itemCategories: [...(db.itemCategories || []), ...added] });
    notify.success(`${added.length} categor${added.length === 1 ? 'y' : 'ies'} imported from items.`);
  };

  const addCategory = async () => {
    const name = String(newName || '').trim();
    if (!name) {
      notify.error('Category name is required.');
      return;
    }
    if (categories.some((c) => String(c.name || '').trim().toLowerCase() === name.toLowerCase())) {
      notify.error('That category already exists.');
      return;
    }
    const nextId = Math.max(0, ...(db.itemCategories || []).map((c) => Number(c.id) || 0)) + 1;
    const description = String(newDescription || '').trim();
    const serverPatch = await saveMaster('itemCategories', name, { description });
    setDb({
      ...db,
      itemCategories: [
        ...(db.itemCategories || []),
        { id: nextId, companyId: currentCompany.id, name, description, ...serverPatch },
      ],
    });
    setNewName('');
    setNewDescription('');
    setCreating(false);
    notify.success(`Category "${name}" created.`);
  };

  const saveEdit = () => {
    const name = String(editing?.name || '').trim();
    if (!name) {
      notify.error('Category name is required.');
      return;
    }
    const clash = categories.some(
      (c) => Number(c.id) !== Number(editing.id) && String(c.name || '').trim().toLowerCase() === name.toLowerCase()
    );
    if (clash) {
      notify.error('Another category already has that name.');
      return;
    }
    const before = categories.find((c) => Number(c.id) === Number(editing.id));
    const oldName = String(before?.name || '').trim();
    if (before) pushMaster({ ...before, name, description: String(editing.description || '').trim() });

    setDb({
      ...db,
      itemCategories: (db.itemCategories || []).map((c) =>
        Number(c.id) === Number(editing.id) ? { ...c, name, description: String(editing.description || '').trim() } : c
      ),
      // Items carry the category by name, so a rename has to follow through.
      items: (db.items || []).map((i) =>
        i.companyId === currentCompany.id && String(i.category || '').trim().toLowerCase() === oldName.toLowerCase()
          ? { ...i, category: name }
          : i
      ),
    });
    setEditing(null);
    notify.success('Category updated.');
  };

  const deleteCategory = async (cat) => {
    const used = countFor(cat.name);
    const ok = await confirmDialog({
      title: 'Delete category',
      message: used
        ? `${used} item(s) use "${cat.name}". They keep the name on the item, but it will no longer be offered here.`
        : `Delete category "${cat.name}"?`,
      confirmLabel: 'Yes, delete',
    });
    if (!ok) return;
    await removeMaster(cat);
    setDb({ ...db, itemCategories: (db.itemCategories || []).filter((c) => Number(c.id) !== Number(cat.id)) });
  };

  return (
    <DocumentListShell
      entity="category"
      title="Item Categories"
      compact
      tight
      className="master-item-list-page"
      headerPortalId="master-itemCategories-header-slot"
      company={currentCompany}
      search={{
        value: catSearch.query,
        onChange: catSearch.setQuery,
        placeholder: 'Search categories…',
        label: 'Search categories',
      }}
      moreItems={[exportMenuItem('Export categories')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Item categories',
          fileName: `ItemCategories_${currentCompany?.name || 'company'}`,
          label: 'categor(y/ies)',
          columns: [
            { key: 'name', label: 'Category' },
            { key: 'description', label: 'Description' },
            { key: 'items', label: 'Items', value: (c) => countFor(c.name) },
          ],
          rows,
        });
      }}
      primary={
        <button type="button" onClick={() => setCreating((value) => !value)} className="ui-btn ui-btn-primary">
          <Plus size={16} aria-hidden="true" /> Add category
        </button>
      }
      above={
        <>
          {orphans.length ? (
            <div className="rounded-xl border p-4 bg-[rgb(var(--warn-soft))] flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm text-[rgb(var(--warn-ink))]">
                {orphans.length} categor{orphans.length === 1 ? 'y is' : 'ies are'} typed on items but not in this master:{' '}
                {orphans.slice(0, 5).join(', ')}
                {orphans.length > 5 ? '…' : ''}
              </div>
              <button type="button" onClick={importOrphans} className="ui-btn ui-btn-primary ui-btn-sm text-xs">
                Import them
              </button>
            </div>
          ) : null}
        </>
      }
    >
      {/* Adding one is two fields and a button, so it lives at the top of the
          list it adds to rather than behind a form somewhere else. */}
      {creating ? <div className="grid grid-cols-1 md:grid-cols-6 gap-2 px-3 py-2" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
        <div className="md:col-span-2">
          <label className="ui-label" htmlFor="cat-name">Category name</label>
          <input
            id="cat-name"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="ui-input w-full"
            placeholder="e.g. Beverages, Spare Parts"
          />
        </div>
        <div className="md:col-span-3">
          <label className="ui-label" htmlFor="cat-description">Description</label>
          <input
            id="cat-description"
            type="text"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            className="ui-input w-full"
            placeholder="Optional"
          />
        </div>
        <div className="flex items-end">
          <button type="button" onClick={addCategory} className="ui-btn ui-btn-secondary w-full">
            Add
          </button>
        </div>
      </div> : null}

        <div className="ui-table-scroll master-item-table-scroll">
          <table className={`ui-table ui-table-wide ui-table-sticky ${rows.length ? '' : 'cash-bank-empty-table'}`}>
            <thead>
              <tr>
                <ColumnHeader label="Category" col="name" state={catFilters} />
                <ColumnHeader label="Description" col="description" state={catFilters} />
                <ColumnHeader label="Items" col="items" state={catFilters} className="ui-num" align="right" />
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan="4">
                    <EmptyState
                      icon={Tags}
                      kind="new"
      title="No categories yet"
                      description="Name the groups you sort your catalogue into — items pick from this list, and discount rules match on it."
                    />
                  </td>
                </tr>
              ) : (
                rows.map((c) => {
                  const isEditing = Number(editing?.id) === Number(c.id);
                  return (
                    <tr key={c.id} className="ui-hover-sunken">
                      <td className="px-4 py-2.5 ui-col-entity">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editing.name}
                            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                            className="ui-input w-full px-2 ui-ctl-compact"
                          />
                        ) : (
                          <span>{c.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 ui-col-meta">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editing.description}
                            onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                            className="ui-input w-full px-2 ui-ctl-compact"
                          />
                        ) : (
                          <span className="ui-muted">{c.description || '—'}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right ui-num">{countFor(c.name)}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {isEditing ? (
                          <>
                            <button type="button" onClick={saveEdit} className="ui-btn ui-btn-primary ui-btn-sm text-xs mr-2">
                              Save
                            </button>
                            <button type="button" onClick={() => setEditing(null)} className="ui-btn ui-btn-secondary ui-btn-sm text-xs">
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => setEditing({ id: c.id, name: c.name, description: c.description || '' })}
                              className="ui-icon-btn mr-1"
                              aria-label={`Edit ${c.name}`}
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteCategory(c)}
                              className="ui-icon-btn text-[rgb(var(--neg))]"
                              aria-label={`Delete ${c.name}`}
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      <TableTotals count={rows.length} totalCount={rows.length} noun="categories" />
    </DocumentListShell>
  );
};

export const GstRatesList = ({ db, setDb, currentCompany }) => {
  const gstRates = (db.gstRates || [])
    .filter((r) => r.companyId === currentCompany.id)
    .slice()
    .sort((a, b) => Number(a.rate) - Number(b.rate));

  const [newRate, setNewRate] = useState('');
  const [newRateName, setNewRateName] = useState('');

  const addRate = async () => {
    const rate = Number(newRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      notify.error('Please enter a valid GST rate (0 to 100).');
      return;
    }

    const exists = gstRates.some((r) => Number(r.rate) === rate);
    if (exists) {
      notify.error('This GST rate already exists.');
      return;
    }

    const name = String(newRateName || '').trim() || `GST ${rate}%`;

    const nextId = Math.max(0, ...(db.gstRates || []).map((r) => Number(r.id) || 0)) + 1;
    const next = {
      id: nextId,
      companyId: currentCompany.id,
      rate,
      name,
    };

    // The named rate becomes a ledger of its own, so tax collected under it
    // is visible in the chart of accounts, not just inside document totals.
    const coa = Array.isArray(db.chartOfAccounts) ? db.chartOfAccounts : [];
    const ledgerExists = coa.some(
      (a) => a.companyId === currentCompany.id && String(a.name || '').trim().toLowerCase() === name.toLowerCase()
    );
    const nextCoaId = coa.reduce((m, a) => Math.max(m, Number(a.id) || 0), 0) + 1;
    const dutiesGroup = (db.accountGroups || []).find(
      (g) => g.companyId === currentCompany.id && /duties|taxes/i.test(String(g.name || ''))
    );
    const rateLedger = ledgerExists
      ? null
      : {
          id: nextCoaId,
          companyId: currentCompany.id,
          code: `GST-${String(rate).replace('.', '_')}`,
          name,
          ledgerCategory: 'Tax',
          groupId: dutiesGroup?.id ?? null,
          type: 'Liability',
          subType: 'Duties & Taxes',
          main: 'Balance Sheet',
          balance: 0,
          gstRate: rate,
          createdAt: new Date().toISOString(),
        };

    // The rate is a reference list like any other: an invoice raised on
    // another machine has to be able to charge a rate this company added.
    const patch = await saveMaster('gstRates', name, { rate });

    setDb({
      ...db,
      gstRates: [...(db.gstRates || []), { ...next, ...patch }],
      ...(rateLedger ? { chartOfAccounts: [...coa, rateLedger] } : {}),
    });
    setNewRate('');
    setNewRateName('');
    notify.success(rateLedger ? `${name} added — ledger created under Duties & Taxes.` : `${name} added.`);
  };

  const deleteRate = async (id) => {
    await removeMaster((db.gstRates || []).find((r) => r.id === id));
    setDb({
      ...db,
      gstRates: (db.gstRates || []).filter((r) => r.id !== id),
    });
  };

  return (
    <DocumentListShell
      entity="gst"
      title="GST Rates"
      company={currentCompany}
      cards={[{ label: 'GST rates', value: gstRates.length, count: true, tone: 'draft', Icon: BadgePercent }]}
      denseCards
    >
        <div className="grid grid-cols-1 gap-2 border-b px-3 py-2 ui-border-c sm:grid-cols-[8rem_minmax(12rem,1fr)_auto]">
          <div>
            <input
              type="number"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              className="ui-input ui-ctl-compact w-full"
              min="0"
              max="100"
              step="0.01"
              aria-label="GST rate percent"
              placeholder="Rate %, e.g. 18"
            />
          </div>
          <div>
            <input
              type="text"
              value={newRateName}
              onChange={(e) => setNewRateName(e.target.value)}
              className="ui-input ui-ctl-compact w-full"
              aria-label="GST rate name"
              placeholder={Number(newRate) > 0 ? `Name, e.g. GST ${Number(newRate)}%` : 'Rate name, e.g. GST 18%'}
            />
          </div>
          <div>
            <button
              type="button"
              onClick={addRate}
              className="ui-btn ui-btn-primary ui-btn-sm w-full sm:w-auto"
            >
              <Plus size={15} /> Add rate
            </button>
          </div>
        </div>

        <div className="ui-table-scroll" style={{ '--table-scroll-h': 'calc(100dvh - 12rem)' }}>
          <table className="ui-table ui-table-wide ui-table-sticky w-full">
            <thead>
              <tr>
                <th>Rate</th>
                <th>Name</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {gstRates.length === 0 ? (
                <tr>
                  <td colSpan="3" className="px-6 py-10 text-center ui-muted">
                    No GST rates found
                  </td>
                </tr>
              ) : (
                gstRates.map((r) => (
                  <tr key={r.id} className="ui-hover-sunken">
                    <td className="px-4 py-2.5 ui-col-entity">{Number(r.rate)}%</td>
                    <td className="px-4 py-2.5 ui-col-meta">{r.name || `GST ${Number(r.rate)}%`}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button type="button" onClick={() => deleteRate(r.id)} aria-label={`Delete ${Number(r.rate)}% rate`} title="Delete" className="text-[rgb(var(--neg))] hover:text-[rgb(var(--neg))]">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

    </DocumentListShell>
  );
};
