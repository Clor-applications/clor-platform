import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Ban, CheckCircle2, Download, MoreVertical, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { PageHeader, EmptyState } from '@ui/components/ui/Primitives';
import { Pagination, usePaged } from '@ui/components/list/ListPageParts';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { useListSearch } from '@ui/components/ListToolbar';
import { notify, confirmDialog } from '@ui/components/ui/notify';
import { pushMaster, removeMaster, saveMaster } from '@ui/utils/masterSync';
import { formatMoney } from '@ui/utils/money';
import { isPriceListInForce } from '@ui/utils/pricing';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';

/** dd MMM yyyy, or an em dash. Lists without a window are open-ended. */
const fmtDate = (v) => {
  const d = String(v || '').slice(0, 10);
  if (!d) return '—';
  const t = new Date(`${d}T00:00:00`);
  if (Number.isNaN(t.getTime())) return '—';
  return t.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * What the list says about itself, versus what it is doing.
 *
 * A list can be marked active and still price nothing because its window has
 * closed. Showing only the flag would be a lie of omission, so an expired list
 * says so — it is the difference between "somebody turned this off" and "this
 * ran out".
 */
function statusOf(list, today) {
  if (String(list.status || 'active').toLowerCase() === 'inactive') return 'inactive';
  return isPriceListInForce(list, today) ? 'active' : 'expired';
}

const STATUS_PILL = {
  active: { label: 'Active', cls: 'ui-pill ui-pill-pos' },
  inactive: { label: 'Inactive', cls: 'ui-pill ui-pill-neutral' },
  expired: { label: 'Expired', cls: 'ui-pill ui-pill-warn' },
};

/**
 * Price lists: named rate cards (Retail, Wholesale, a key account…) holding a
 * per-item rate. A customer (or a customer group) points at one; invoicing
 * resolves the rate from the list before the item master's sale price
 * (src/utils/pricing.js).
 */
export default function PriceLists({ db, setDb, currentCompany }) {
  const companyId = currentCompany.id;
  const lists = useMemo(
    () => (Array.isArray(db.priceLists) ? db.priceLists.filter((p) => p.companyId === companyId) : []),
    [db.priceLists, companyId]
  );
  const items = useMemo(() => (db.items || []).filter((i) => i.companyId === companyId), [db.items, companyId]);
  const customers = useMemo(() => (db.customers || []).filter((c) => c.companyId === companyId), [db.customers, companyId]);

  const [editingId, setEditingId] = useState(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [openMenu, setOpenMenu] = useState(null);
  const menuRef = useRef(null);

  const today = new Date().toISOString().slice(0, 10);

  /**
   * The row menu is fixed-position, so it has to close on anything that moves
   * the row out from under it — the same contract the other list pages use.
   */
  useEffect(() => {
    if (!openMenu?.id) return undefined;
    const onMouseDown = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      const btn = e.target?.closest?.('[data-pl-menu-button]');
      if (btn && String(btn.getAttribute('data-pl-menu-button')) === String(openMenu.id)) return;
      setOpenMenu(null);
    };
    const away = () => setOpenMenu(null);
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [openMenu]);
  const editing = lists.find((p) => Number(p.id) === Number(editingId)) || null;

  /*
   * Every change to a price list goes to the server as well.
   *
   * The row is pushed whole rather than as a patch: a price list is read whole
   * when an invoice is priced, and reconstructing a partial update on the
   * server would be a second place for the rates to be wrong.
   *
   * Computed here rather than inside the setDb updater — an updater has to be
   * pure, and React may run it twice.
   */
  const patchList = (id, patch) => {
    const row = (db.priceLists || []).find((p) => Number(p.id) === Number(id));
    if (row) pushMaster({ ...row, ...patch });
    setDb((prev) => ({
      ...prev,
      priceLists: (prev.priceLists || []).map((p) => (Number(p.id) === Number(id) ? { ...p, ...patch } : p)),
    }));
  };

  const createList = async () => {
    const name = newName.trim();
    if (!name) {
      notify.error('Give the price list a name (Retail, Wholesale…)');
      return;
    }
    if (lists.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      notify.error('A price list with that name already exists.');
      return;
    }
    const nextId = (db.priceLists || []).reduce((m, p) => Math.max(m, Number(p.id) || 0), 0) + 1;
    /*
     * A price list decides what rate lands on an invoice. Held in one browser,
     * the same customer was quoted differently depending on who raised the
     * document, and clearing that browser lost the prices outright.
     */
    const serverPatch = await saveMaster('priceLists', name, {
      description: '', applyTo: 'all', validFrom: '', validTo: '', status: 'active', rates: {},
    });
    setDb((prev) => ({
      ...prev,
      priceLists: [
        ...(prev.priceLists || []),
        {
          id: nextId,
          companyId,
          name,
          description: '',
          applyTo: 'all',
          validFrom: '',
          validTo: '',
          status: 'active',
          rates: {},
          createdAt: new Date().toISOString(),
          ...serverPatch,
        },
      ],
    }));
    setNewName('');
    setCreating(false);
    setEditingId(nextId);
    notify.success(`Price list "${name}" created.`);
  };

  const removeList = async (list) => {
    const users = customers.filter((c) => Number(c.priceListId) === Number(list.id)).length;
    const ok = await confirmDialog({
      title: 'Delete price list',
      message: `Delete "${list.name}"?${users ? ` ${users} customer(s) currently use it and will fall back to standard rates.` : ''}`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await removeMaster(list);
    setDb((prev) => ({
      ...prev,
      priceLists: (prev.priceLists || []).filter((p) => Number(p.id) !== Number(list.id)),
      customers: (prev.customers || []).map((c) =>
        c.companyId === companyId && Number(c.priceListId) === Number(list.id) ? { ...c, priceListId: null } : c
      ),
    }));
    if (Number(editingId) === Number(list.id)) setEditingId(null);
  };

  const setRate = (itemId, value) => {
    // The rates are the price list. Same rule as every other field on it.
    const row = (db.priceLists || []).find((p) => Number(p.id) === Number(editingId));
    if (row) {
      const rates = { ...(row.rates || {}) };
      const n = Number(value);
      if (!value || !Number.isFinite(n) || n <= 0) delete rates[String(itemId)];
      else rates[String(itemId)] = n;
      pushMaster({ ...row, rates });
    }
    setDb((prev) => ({
      ...prev,
      priceLists: (prev.priceLists || []).map((p) => {
        if (Number(p.id) !== Number(editingId)) return p;
        const rates = { ...(p.rates || {}) };
        const n = Number(value);
        if (!value || !Number.isFinite(n) || n <= 0) delete rates[String(itemId)];
        else rates[String(itemId)] = n;
        return { ...p, rates };
      }),
    }));
  };

  const assignCustomer = (customerId, listIdRaw) => {
    const listId = listIdRaw === '' ? null : Number(listIdRaw);
    setDb((prev) => ({
      ...prev,
      customers: (prev.customers || []).map((c) =>
        c.companyId === companyId && Number(c.id) === Number(customerId) ? { ...c, priceListId: listId } : c
      ),
    }));
  };

  /* ---------------- the list ---------------- */

  const plSearch = useListSearch(lists, ['name', 'description']);
  const searched = plSearch.filtered;

  /*
   * Counted over what the search left standing, not over the whole book.
   *
   * Reading `lists` here meant typing a name narrowed the table to two rows
   * while the tabs above still said eleven — the figures and the rows
   * describing different sets of data on one screen. Counted before the status
   * tab is applied, so picking one does not zero the others.
   */
  const counts = useMemo(() => {
    const c = { All: searched.length, Active: 0, Inactive: 0, Expired: 0 };
    for (const p of searched) {
      const st = statusOf(p, today);
      if (st === 'active') c.Active += 1;
      else if (st === 'inactive') c.Inactive += 1;
      else c.Expired += 1;
    }
    return c;
  }, [searched, today]);

  const filtered = useMemo(() => {
    if (statusFilter === 'All') return searched;
    return searched.filter((p) => statusOf(p, today) === statusFilter.toLowerCase());
  }, [searched, statusFilter, today]);

  const { pageCount, safePage, pageRows } = usePaged(filtered, perPage, page);

  const exportColumns = [
    { key: 'name', label: 'Price list' },
    { key: 'applyTo', label: 'Apply to', value: (r) => (r.applyTo === 'selected' ? 'Selected items' : 'All items') },
    { key: 'validFrom', label: 'From' },
    { key: 'validTo', label: 'To' },
    { key: 'createdAt', label: 'Created on', value: (r) => String(r.createdAt || '').slice(0, 10) },
    { key: 'status', label: 'Status', value: (r) => STATUS_PILL[statusOf(r, today)].label },
    { key: 'priced', label: 'Items priced', value: (r) => Object.keys(r.rates || {}).length },
    { key: 'description', label: 'Description' },
  ];

  if (!editing) {
    return (
      <DocumentListShell
        entity="category"
        title="Price Lists"
        compact
        tight
        className="master-item-list-page"
        headerPortalId="master-priceLists-header-slot"
        company={currentCompany}
        search={{
          value: plSearch.query,
          onChange: (v) => {
            plSearch.setQuery(v);
            setPage(1);
          },
          placeholder: 'Search price lists…',
          label: 'Search price lists',
        }}
        headerExtras={
          creating ? (
            <>
              <input
                type="text"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    createList();
                  }
                  if (e.key === 'Escape') {
                    setCreating(false);
                    setNewName('');
                  }
                }}
                className="ui-input w-44 px-2 text-sm"
                placeholder="Retail, Wholesale…"
                aria-label="New price list name"
              />
              <button type="button" onClick={createList} className="ui-btn ui-btn-secondary">
                Create
              </button>
            </>
          ) : null
        }
        moreItems={[exportMenuItem('Export price lists')]}
        onMoreSelect={(k) => {
          const format = exportFormatFromKey(k);
          if (!format) return;
          runListExport({
            format,
            title: 'Price lists',
            fileName: `PriceLists_${currentCompany?.name || 'company'}`,
            label: 'price list(s)',
            columns: exportColumns,
            rows: filtered,
          });
        }}
        primary={
          <button type="button" onClick={() => setCreating(true)} className="ui-btn ui-btn-primary">
            <Plus size={16} aria-hidden="true" /> New price list
          </button>
        }
        tabs={[
          { value: 'All', label: 'All', tone: 'all' },
          { value: 'Active', label: 'Active', tone: 'paid' },
          { value: 'Inactive', label: 'Inactive', tone: 'draft' },
          { value: 'Expired', label: 'Expired', tone: 'overdue' },
        ]}
        tabsLabel="Price list status"
        statusInHeader
        statusValue={statusFilter}
        statusCounts={counts}
        onStatusChange={(v) => {
          setStatusFilter(v);
          setPage(1);
        }}
      >
        <div className="ui-table-scroll master-item-table-scroll">
              <table className={`ui-table ui-table-wide ui-table-sticky ${pageRows.length ? '' : 'cash-bank-empty-table'}`}>
                <thead>
                  <tr>
                    <th scope="col">Price list name</th>
                    <th scope="col">Apply to</th>
                    <th scope="col">From</th>
                    <th scope="col">To</th>
                    <th scope="col">Created on</th>
                    <th scope="col">Status</th>
                    <th scope="col">Description</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="ui-rows">
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan="8">
                        <EmptyState
                          icon={Tags}
                          kind="new"
      title={lists.length ? 'Nothing matches' : 'No price lists yet'}
                          description={
                            lists.length
                              ? 'No price list matches the search or the status filter.'
                              : "A price list is a rate card — Retail, Wholesale, a key account. Invoicing reads the customer's list before the item's own price."
                          }
                          routes={
                            lists.length
                              ? undefined
                              : [
                                  {
                                    label: 'Make one now',
                                    description: 'Name the card, then set the rates that beat the item price.',
                                    onSelect: () => setCreating(true),
                                  },
                                ]
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((p) => {
                      const st = statusOf(p, today);
                      const pill = STATUS_PILL[st];
                      return (
                        <tr key={p.id} className="ui-row">
                          <td className="ui-td">
                            <button
                              type="button"
                              onClick={() => setEditingId(p.id)}
                              className="ui-col-doc"
                              style={{ background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }}
                            >
                              {p.name}
                            </button>
                            <div className="ui-subtle text-xs">
                              {Object.keys(p.rates || {}).length} item{Object.keys(p.rates || {}).length === 1 ? '' : 's'} priced
                            </div>
                          </td>
                          <td className="ui-td">{p.applyTo === 'selected' ? 'Selected items' : 'All items'}</td>
                          <td className="ui-td">{fmtDate(p.validFrom)}</td>
                          <td className="ui-td">{fmtDate(p.validTo)}</td>
                          <td className="ui-td">{fmtDate(p.createdAt)}</td>
                          <td className="ui-td"><span className={pill.cls}>{pill.label}</span></td>
                          <td className="ui-td ui-subtle">{p.description || '—'}</td>
                          <td className="ui-td text-right">
                            <button
                              type="button"
                              data-pl-menu-button={p.id}
                              onClick={(e) => {
                                const r = e.currentTarget.getBoundingClientRect();
                                setOpenMenu(
                                  openMenu?.id === p.id
                                    ? null
                                    : { id: p.id, left: Math.max(8, r.right - 190), top: r.bottom + 6 }
                                );
                              }}
                              className="ui-icon-btn ui-btn-sm !w-8"
                              aria-haspopup="menu"
                              aria-expanded={openMenu?.id === p.id}
                              aria-label={`Actions for ${p.name}`}
                            >
                              <MoreVertical size={16} aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
        </div>

        <Pagination
          total={filtered.length}
          page={safePage}
          perPage={perPage}
          pageCount={pageCount}
          onPage={setPage}
          onPerPage={(n) => {
            setPerPage(n);
            setPage(1);
          }}
          noun="price lists"
        />

        {openMenu?.id ? (
          <div
            ref={menuRef}
            className="fixed w-48 ui-surface border rounded-lg shadow-lg overflow-hidden"
            style={{ left: openMenu.left, top: openMenu.top, zIndex: 'var(--z-popover)' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="py-1" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setEditingId(openMenu.id);
                  setOpenMenu(null);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[rgb(var(--surface-sunken))]"
              >
                <Pencil size={16} aria-hidden="true" /> Edit
              </button>
              {(() => {
                const p = lists.find((x) => Number(x.id) === Number(openMenu.id));
                const off = String(p?.status || 'active').toLowerCase() === 'inactive';
                return (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      patchList(openMenu.id, { status: off ? 'active' : 'inactive' });
                      notify.success(off ? `"${p.name}" is active again.` : `"${p.name}" will no longer price anything.`);
                      setOpenMenu(null);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[rgb(var(--surface-sunken))]"
                  >
                    {off ? <CheckCircle2 size={16} aria-hidden="true" /> : <Ban size={16} aria-hidden="true" />}
                    {off ? 'Activate' : 'Deactivate'}
                  </button>
                );
              })()}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const p = lists.find((x) => Number(x.id) === Number(openMenu.id));
                  setOpenMenu(null);
                  if (p) removeList(p);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[rgb(var(--surface-sunken))]"
                style={{ color: 'rgb(var(--neg))', borderTop: '1px solid rgb(var(--border))' }}
              >
                <Trash2 size={16} aria-hidden="true" /> Delete
              </button>
            </div>
          </div>
        ) : null}
      </DocumentListShell>
    );
  }

  /* ---------------- one list ---------------- */

  const filteredItems = items.filter((i) => !search || String(i.name || '').toLowerCase().includes(search.toLowerCase()));
  const st = statusOf(editing, today);

  return (
    <div className="space-y-6">
      <PageHeader
        entity="category"
        title={editing.name}
        actions={
          <>
            <span className={STATUS_PILL[st].cls}>{STATUS_PILL[st].label}</span>
            <button type="button" onClick={() => setEditingId(null)} className="ui-btn ui-btn-secondary">
              <ArrowLeft size={16} aria-hidden="true" /> All price lists
            </button>
          </>
        }
      />

      {/*
        The window and the flag are the two things that decide whether this list
        prices anything, so they sit above the rates rather than behind a
        settings tab. Both bounds are optional: a list with neither is
        open-ended, which is what every list made before these fields existed
        already is.
      */}
      <section className="ui-card p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="ui-label" htmlFor="pl-apply">Apply to</label>
            <select
              id="pl-apply"
              className="ui-select"
              value={editing.applyTo || 'all'}
              onChange={(e) => patchList(editing.id, { applyTo: e.target.value })}
            >
              <option value="all">All items</option>
              <option value="selected">Selected items</option>
            </select>
          </div>
          <div>
            <label className="ui-label" htmlFor="pl-from">Valid from</label>
            <input
              id="pl-from"
              type="date"
              className="ui-input"
              value={String(editing.validFrom || '').slice(0, 10)}
              onChange={(e) => patchList(editing.id, { validFrom: e.target.value })}
            />
          </div>
          <div>
            <label className="ui-label" htmlFor="pl-to">Valid to</label>
            <input
              id="pl-to"
              type="date"
              className="ui-input"
              value={String(editing.validTo || '').slice(0, 10)}
              onChange={(e) => patchList(editing.id, { validTo: e.target.value })}
            />
          </div>
          <div>
            <label className="ui-label" htmlFor="pl-desc">Description</label>
            <input
              id="pl-desc"
              type="text"
              className="ui-input"
              value={editing.description || ''}
              onChange={(e) => patchList(editing.id, { description: e.target.value })}
              placeholder="Default retail prices"
            />
          </div>
        </div>
        {st === 'expired' ? (
          <p className="ui-t-body mt-3" style={{ color: 'rgb(var(--warn))' }}>
            This list is marked active but its window closed on {fmtDate(editing.validTo)}, so it is not pricing anything.
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="ui-card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="ui-t-sec">Item rates</h3>
            <button type="button" onClick={() => removeList(editing)} className="ui-icon-btn ui-btn-sm !w-8" aria-label="Delete list">
              <Trash2 size={14} />
            </button>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ui-input mb-3 w-full"
            placeholder="Search items"
            aria-label="Search items"
          />
          <div className="max-h-96 overflow-y-auto">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th className="ui-th">Item</th>
                  <th className="ui-th">Standard</th>
                  <th className="ui-th">This list</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredItems.map((i) => (
                  <tr key={i.id}>
                    <td className="ui-td">{i.name}</td>
                    <td className="ui-td ui-col-amount">{formatMoney(Number(i.salePrice || 0), currentCompany)}</td>
                    <td className="ui-td">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editing.rates?.[String(i.id)] ?? ''}
                        onChange={(e) => setRate(i.id, e.target.value)}
                        className="ui-input w-28 px-2 text-sm ui-ctl-compact"
                        placeholder="—"
                        aria-label={`Rate for ${i.name}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="ui-card p-4">
          <h3 className="ui-t-sec mb-3">Customer assignment</h3>
          <div className="max-h-[28rem] overflow-y-auto">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th className="ui-th">Customer</th>
                  <th className="ui-th">Price list</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td className="ui-td ui-col-entity">{c.displayName || c.name}</td>
                    <td className="ui-td">
                      <select
                        value={c.priceListId ?? ''}
                        onChange={(e) => assignCustomer(c.id, e.target.value)}
                        className="ui-select w-40 px-2 text-sm ui-ctl-compact"
                        aria-label={`Price list for ${c.displayName || c.name}`}
                      >
                        <option value="">Standard rates</option>
                        {lists.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
