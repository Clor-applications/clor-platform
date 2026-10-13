import React, { useMemo, useState } from 'react';
import { Plus, Trash2, BadgePercent } from 'lucide-react';
import { PageHeader, EmptyState, StatusPill } from '@ui/components/ui/Primitives';
import { ListToolbar, exportRows, useListSearch } from '@ui/components/ListToolbar';
import { notify, confirmDialog } from '@ui/components/ui/notify';
import { patchMaster, removeMaster, saveMaster } from '@ui/utils/masterSync';
import { getCustomerDisplayName } from '@ui/utils/contacts';

/**
 * Discount rules — every discount type the sales team asks for, one engine:
 * item / category / customer / customer-group scoped, percentage or fixed,
 * quantity breaks (buy 10 → 5%…), promotional windows. Invoicing applies the
 * best matching rule automatically (src/utils/discounts.js).
 */

const emptyForm = {
  name: '',
  type: 'PERCENT',
  value: '',
  itemScope: 'ALL',
  itemId: '',
  itemIds: [],
  category: '',
  customerScope: 'ALL',
  customerId: '',
  customerIds: [],
  groupId: '',
  validFrom: '',
  validTo: '',
  qtyTiers: [],
};

export default function DiscountRules({ db, setDb, currentCompany }) {
  const companyId = currentCompany.id;
  const rules = useMemo(
    () => (Array.isArray(db.discountRules) ? db.discountRules.filter((r) => r.companyId === companyId) : []),
    [db.discountRules, companyId]
  );
  const items = (db.items || []).filter((i) => i.companyId === companyId);
  const customers = (db.customers || []).filter((c) => c.companyId === companyId);
  const groups = (db.accountGroups || []).filter((g) => g.companyId === companyId && String(g.groupCategory || '') === 'Customer');
  // The master first, plus anything still typed on an item, so an older rule
  // can always be re-picked.
  const categories = [
    ...new Set([
      ...(db.itemCategories || [])
        .filter((c) => c.companyId === currentCompany.id)
        .map((c) => String(c.name || '').trim()),
      ...items.map((i) => String(i.category || '').trim()),
    ].filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    const name = form.name.trim();
    if (!name) {
      notify.error('Give the rule a name (e.g. "Bulk buy", "Diwali offer").');
      return;
    }
    const tiers = form.qtyTiers.map((t) => ({ minQty: Number(t.minQty) || 0, value: Number(t.value) || 0 })).filter((t) => t.minQty > 0 && t.value > 0);
    if (!tiers.length && !(Number(form.value) > 0)) {
      notify.error('Set a discount value, or add quantity tiers.');
      return;
    }
    if (form.itemScope === 'ITEM' && !form.itemId) {
      notify.error('Pick the item this rule applies to.');
      return;
    }
    if (form.itemScope === 'ITEMS' && !form.itemIds.length) {
      notify.error('Pick at least one item this rule applies to.');
      return;
    }
    if (form.itemScope === 'CATEGORY' && !form.category.trim()) {
      notify.error('Pick the item category this rule applies to.');
      return;
    }
    if (form.customerScope === 'CUSTOMER' && !form.customerId) {
      notify.error('Pick the customer this rule applies to.');
      return;
    }
    if (form.customerScope === 'CUSTOMERS' && !form.customerIds.length) {
      notify.error('Pick at least one customer this rule applies to.');
      return;
    }
    if (form.customerScope === 'GROUP' && !form.groupId) {
      notify.error('Pick the customer group this rule applies to.');
      return;
    }
    const nextId = (db.discountRules || []).reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
    const rule = {
      active: true,
      type: form.type,
      value: Number(form.value) || 0,
      itemScope: form.itemScope,
      itemId: form.itemScope === 'ITEM' ? Number(form.itemId) : null,
      itemIds: form.itemScope === 'ITEMS' ? form.itemIds.map(Number) : [],
      category: form.itemScope === 'CATEGORY' ? form.category.trim() : null,
      customerScope: form.customerScope,
      customerId: form.customerScope === 'CUSTOMER' ? Number(form.customerId) : null,
      customerIds: form.customerScope === 'CUSTOMERS' ? form.customerIds.map(Number) : [],
      groupId: form.customerScope === 'GROUP' ? Number(form.groupId) : null,
      validFrom: form.validFrom || null,
      validTo: form.validTo || null,
      qtyTiers: tiers,
    };
    /*
     * A discount rule decides what a customer is charged. Held in one browser,
     * two people invoicing the same customer quoted two different prices.
     */
    const serverPatch = await saveMaster('discountRules', name, rule);
    setDb((prev) => ({
      ...prev,
      discountRules: [
        ...(prev.discountRules || []),
        {
          id: nextId,
          companyId,
          name,
          active: true,
          type: form.type,
          value: Number(form.value) || 0,
          itemScope: form.itemScope,
          itemId: form.itemScope === 'ITEM' ? Number(form.itemId) : null,
          itemIds: form.itemScope === 'ITEMS' ? form.itemIds.map(Number) : [],
          category: form.itemScope === 'CATEGORY' ? form.category.trim() : null,
          customerScope: form.customerScope,
          customerId: form.customerScope === 'CUSTOMER' ? Number(form.customerId) : null,
          customerIds: form.customerScope === 'CUSTOMERS' ? form.customerIds.map(Number) : [],
          groupId: form.customerScope === 'GROUP' ? Number(form.groupId) : null,
          validFrom: form.validFrom || null,
          validTo: form.validTo || null,
          qtyTiers: tiers,
          createdAt: new Date().toISOString(),
          ...serverPatch,
        },
      ],
    }));
    setOpen(false);
    setForm(emptyForm);
    notify.success(`Discount rule "${name}" created.`);
  };

  const toggle = (rule) => {
    // A rule switched off has to be off everywhere, not just here.
    patchMaster(rule, { isActive: rule.active === false });
    setDb((prev) => ({
      ...prev,
      discountRules: (prev.discountRules || []).map((r) => (r.id === rule.id ? { ...r, active: r.active === false } : r)),
    }));
  };

  const remove = async (rule) => {
    const ok = await confirmDialog({ title: 'Delete rule', message: `Delete "${rule.name}"?`, confirmLabel: 'Delete' });
    if (!ok) return;
    await removeMaster(rule);
    setDb((prev) => ({ ...prev, discountRules: (prev.discountRules || []).filter((r) => r.id !== rule.id) }));
  };

  const scopeLabel = (r) => {
    const itemPart =
      r.itemScope === 'ITEM'
        ? items.find((i) => Number(i.id) === Number(r.itemId))?.name || 'item'
        : r.itemScope === 'ITEMS'
          ? `${(r.itemIds || []).length} items`
          : r.itemScope === 'CATEGORY'
            ? `category "${r.category}"`
            : 'all items';
    const custPart =
      r.customerScope === 'CUSTOMER'
        ? getCustomerDisplayName(customers.find((c) => Number(c.id) === Number(r.customerId))) || 'customer'
        : r.customerScope === 'CUSTOMERS'
          ? `${(r.customerIds || []).length} customers`
          : r.customerScope === 'GROUP'
            ? groups.find((g) => Number(g.id) === Number(r.groupId))?.name || 'group'
            : 'all customers';
    return `${itemPart} · ${custPart}`;
  };

  const valueLabel = (r) => {
    if (Array.isArray(r.qtyTiers) && r.qtyTiers.length) {
      return r.qtyTiers
        .slice()
        .sort((a, b) => a.minQty - b.minQty)
        .map((t) => `${t.minQty}+ → ${t.value}${r.type === 'PERCENT' ? '%' : '₹/unit'}`)
        .join(', ');
    }
    return r.type === 'PERCENT' ? `${r.value}%` : `₹${r.value}/unit`;
  };

  const drSearch = useListSearch(rules, ['name', 'type', (r) => scopeLabel(r)]);
  const shownRules = drSearch.filtered;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          entity="tax"
          title="Discount Rules"
        />
        <button type="button" onClick={() => setOpen(true)} className="ui-btn ui-btn-primary">
          <Plus size={16} aria-hidden="true" /> New Rule
        </button>
      </div>

      {open ? (
        <div className="ui-card space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="ui-label" htmlFor="discountrules-rule-name">Rule name</label>
              <input id="discountrules-rule-name" type="text" value={form.name} onChange={set('name')} className="ui-input w-full" placeholder="Bulk buy / Diwali offer" />
            </div>
            <div>
              <label className="ui-label" htmlFor="discountrules-discount-type">Discount type</label>
              <select id="discountrules-discount-type" value={form.type} onChange={set('type')} className="ui-select w-full">
                <option value="PERCENT">Percentage</option>
                <option value="FIXED">Fixed amount per unit</option>
              </select>
            </div>
            <div>
              <label className="ui-label">Value ({form.type === 'PERCENT' ? '%' : '₹/unit'})</label>
              <input type="number" min="0" step="0.01" value={form.value} onChange={set('value')} className="ui-input w-full" placeholder="Ignored when tiers are set" />
            </div>
            <div>
              <label className="ui-label" htmlFor="discountrules-applies-to-items">Applies to items</label>
              <select id="discountrules-applies-to-items" value={form.itemScope} onChange={set('itemScope')} className="ui-select w-full">
                <option value="ALL">All items</option>
                <option value="ITEM">One item</option>
                <option value="ITEMS">Multiple items</option>
                <option value="CATEGORY">A category</option>
              </select>
            </div>
            {form.itemScope === 'ITEM' ? (
              <div>
                <label className="ui-label" htmlFor="discountrules-item">Item</label>
                <select id="discountrules-item" value={form.itemId} onChange={set('itemId')} className="ui-select w-full">
                  <option value="">Select item</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
              </div>
            ) : form.itemScope === 'ITEMS' ? (
              <div>
                <label className="ui-label">Items ({form.itemIds.length} selected)</label>
                <div className="ui-input max-h-36 overflow-y-auto p-2 space-y-1">
                  {items.map((i) => (
                    <label key={i.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="ui-checkbox"
                        checked={form.itemIds.includes(i.id)}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            itemIds: e.target.checked ? [...p.itemIds, i.id] : p.itemIds.filter((x) => x !== i.id),
                          }))
                        }
                      />
                      {i.name}
                    </label>
                  ))}
                </div>
              </div>
            ) : form.itemScope === 'CATEGORY' ? (
              <div>
                <label className="ui-label" htmlFor="discountrules-category">Category</label>
                <select id="discountrules-category" value={form.category} onChange={set('category')} className="ui-select w-full">
                  <option value="">Select category</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {categories.length === 0 ? (
                  <div className="text-xs ui-muted mt-1">No categories yet — add them under Master Data → Item Categories.</div>
                ) : null}
              </div>
            ) : (
              <div />
            )}
            <div>
              <label className="ui-label" htmlFor="discountrules-applies-to-customers">Applies to customers</label>
              <select id="discountrules-applies-to-customers" value={form.customerScope} onChange={set('customerScope')} className="ui-select w-full">
                <option value="ALL">All customers</option>
                <option value="CUSTOMER">One customer</option>
                <option value="CUSTOMERS">Multiple customers</option>
                <option value="GROUP">A customer group</option>
              </select>
            </div>
            {form.customerScope === 'CUSTOMERS' ? (
              <div>
                <label className="ui-label">Customers ({form.customerIds.length} selected)</label>
                <div className="ui-input max-h-36 overflow-y-auto p-2 space-y-1">
                  {customers.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="ui-checkbox"
                        checked={form.customerIds.includes(c.id)}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            customerIds: e.target.checked ? [...p.customerIds, c.id] : p.customerIds.filter((x) => x !== c.id),
                          }))
                        }
                      />
                      {getCustomerDisplayName(c)}
                    </label>
                  ))}
                </div>
              </div>
            ) : form.customerScope === 'CUSTOMER' ? (
              <div>
                <label className="ui-label" htmlFor="discountrules-customer">Customer</label>
                <select id="discountrules-customer" value={form.customerId} onChange={set('customerId')} className="ui-select w-full">
                  <option value="">Select customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{getCustomerDisplayName(c)}</option>
                  ))}
                </select>
              </div>
            ) : form.customerScope === 'GROUP' ? (
              <div>
                <label className="ui-label" htmlFor="discountrules-customer-group">Customer group</label>
                <select id="discountrules-customer-group" value={form.groupId} onChange={set('groupId')} className="ui-select w-full">
                  <option value="">Select group</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div />
            )}
            <div>
              <label className="ui-label" htmlFor="discountrules-valid-from-promotional">Valid from (promotional)</label>
              <input id="discountrules-valid-from-promotional" type="date" value={form.validFrom} onChange={set('validFrom')} className="ui-input w-full" />
            </div>
            <div>
              <label className="ui-label" htmlFor="discountrules-valid-to">Valid to</label>
              <input id="discountrules-valid-to" type="date" value={form.validTo} onChange={set('validTo')} className="ui-input w-full" />
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="ui-label">Quantity tiers (optional — e.g. buy 10 → 5%, 50 → 10%, 100 → 15%)</label>
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, qtyTiers: [...p.qtyTiers, { minQty: '', value: '' }] }))}
                className="ui-btn ui-btn-secondary ui-btn-sm"
              >
                + Tier
              </button>
            </div>
            {form.qtyTiers.map((t, ti) => (
              <div key={ti} className="mb-1.5 flex items-center gap-2 text-sm">
                <span className="ui-muted">Buy</span>
                <input
                  type="number"
                  min="1"
                  value={t.minQty}
                  onChange={(e) => setForm((p) => ({ ...p, qtyTiers: p.qtyTiers.map((x, i) => (i === ti ? { ...x, minQty: e.target.value } : x)) }))}
                  className="ui-input ui-btn-sm w-20 px-2 text-sm"
                />
                <span className="ui-muted">or more →</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={t.value}
                  onChange={(e) => setForm((p) => ({ ...p, qtyTiers: p.qtyTiers.map((x, i) => (i === ti ? { ...x, value: e.target.value } : x)) }))}
                  className="ui-input w-24 px-2 text-sm ui-ctl-compact"
                />
                <span className="ui-muted">{form.type === 'PERCENT' ? '% off' : '₹ off per unit'}</span>
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, qtyTiers: p.qtyTiers.filter((_, i) => i !== ti) }))}
                  className="ui-icon-btn !h-7 !w-7"
                  aria-label="Remove tier"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="ui-btn ui-btn-secondary">Cancel</button>
            <button type="button" onClick={save} className="ui-btn ui-btn-primary">Create Rule</button>
          </div>
        </div>
      ) : null}

      <ListToolbar
        search={drSearch.query}
        onSearch={drSearch.setQuery}
        placeholder="Search rules (name, scope, type)"
        count={shownRules.length}
        countLabel="rules"
        onExport={() =>
          exportRows({
            fileName: `DiscountRules_${currentCompany?.name || 'company'}`,
            label: 'rule(s)',
            columns: [
              { key: 'name', label: 'Rule' },
              { key: 'scope', label: 'Scope', value: (r) => scopeLabel(r) },
              { key: 'discount', label: 'Discount', value: (r) => valueLabel(r) },
              { key: 'validFrom', label: 'Valid from' },
              { key: 'validTo', label: 'Valid to' },
              { key: 'status', label: 'Status', value: (r) => (r.active === false ? 'Paused' : 'Active') },
            ],
            rows: shownRules,
          })
        }
      />

      {rules.length === 0 ? (
        <div className="ui-card">
          <EmptyState icon={BadgePercent} title="No discount rules" description="Create quantity breaks, customer specials, or a promotional window — invoicing applies them automatically." />
        </div>
      ) : (
        <div className="ui-card overflow-x-auto">
          <table className="ui-table w-full">
            <thead>
              <tr>
                <th className="ui-th">Rule</th>
                <th className="ui-th">Scope</th>
                <th className="ui-th">Discount</th>
                <th className="ui-th">Window</th>
                <th className="ui-th ui-col-h-center">Status</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {shownRules.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="ui-col-entity px-4 py-2.5">{r.name}</td>
                  <td className="ui-col-meta px-4 py-2.5">{scopeLabel(r)}</td>
                  <td className="px-4 py-2.5">{valueLabel(r)}</td>
                  <td className="ui-col-date px-4 py-2.5">
                    {r.validFrom || r.validTo ? `${r.validFrom || '…'} → ${r.validTo || '…'}` : 'Always'}
                  </td>
                  <td className="px-4 py-2.5"><StatusPill status={r.active === false ? 'Paused' : 'Active'} /></td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button type="button" onClick={() => toggle(r)} className="ui-btn ui-btn-secondary ui-btn-sm text-xs">
                        {r.active === false ? 'Activate' : 'Pause'}
                      </button>
                      <button type="button" onClick={() => remove(r)} className="ui-icon-btn ui-btn-sm !w-8" aria-label={`Delete ${r.name}`}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
