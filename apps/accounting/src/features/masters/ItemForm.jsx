import { useMemo, useState } from 'react';
import { FileText, Info, Package } from 'lucide-react';

import FormSection from '@ui/components/ui/FormSection';
import MasterFormPage from '@ui/components/MasterFormPage';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import Drawer from '@ui/components/ui/Drawer';
import { FieldError } from '@ui/components/ui/Primitives';
import { FormRow as PartyFormRow } from '../../components/pickers/customerFormParts';
import { notify } from '@ui/components/ui/notify';
import { useFieldErrors } from '@ui/components/ui/useFieldErrors';
import { useFeatures } from '@ui/permissions/useFeatures';
import { bumpItemCodeSeries, nextItemCode } from '@ui/utils/itemCode';
import { saveItemToServer } from '@ui/utils/itemSync';
import { saveMaster } from '@ui/utils/masterSync';
import { formatMoney, round2 } from '@ui/utils/money';

/* Item cards place two field rows side by side. Their label gutter is kept
   compact so each control remains inside its own half of the drawer. */
const ItemFormRow = (props) => <PartyFormRow {...props} compact />;

/**
 * What the business buys and sells, in one form.
 *
 * It lived inside App.jsx, which meant the only screen that could open it was
 * App.jsx itself: creating an item from a bill or invoice line got a second,
 * smaller form with its own idea of what an item needs. Same form, one file,
 * so both doors open onto the same questions.
 */

const ItemForm = ({
  db,
  setDb,
  currentCompany,
  warehouses = [],
  branches = [],
  initialData = null,
  onClose,
  fullPage = false,
  onNavigate = null,
  /* What was typed in the picker that had no match — the name is the reason
     this form was opened, so it arrives already filled in. */
  defaultName = '',
  /* Handed the item that was just made, so the document line that asked for
     it can put it on itself instead of sending somebody back to look for it. */
  onCreated = null,
}) => {
  const { isEnabled: itemFeatureEnabled } = useFeatures();
  // Batch and expiry are only offered when the company has switched the
  // capability on; nothing downstream asks for a batch otherwise.
  const batchCapable = itemFeatureEnabled('batchExpiry') || itemFeatureEnabled('batchSerial');
  const itemErrors = useFieldErrors('item');
  const isEdit = Boolean(initialData);

  const [formData, setFormData] = useState(() => {
    if (initialData) {
      return {
        code: String(initialData.code || ''),
        name: String(initialData.name || ''),
        description: String(initialData.description || ''),
        category: String(initialData.category || ''),
        type: initialData.type || 'Goods',
        unit: initialData.unit || 'Pcs',
        hsnSac: String(initialData.hsnSac || ''),
        gstRate: Number.isFinite(Number(initialData.gstRate)) ? Number(initialData.gstRate) : 0,
        salePrice: Number.isFinite(Number(initialData.salePrice)) ? Number(initialData.salePrice) : 0,
        purchasePrice: Number.isFinite(Number(initialData.purchasePrice)) ? Number(initialData.purchasePrice) : 0,
        mrp: Number.isFinite(Number(initialData.mrp)) ? Number(initialData.mrp) : '',
        trackingType: initialData.trackingType || 'NONE',
        barcode: String(initialData.barcode || ''),
        reorderLevel: Number.isFinite(Number(initialData.reorderLevel)) ? Number(initialData.reorderLevel) : '',
        openingWarehouseId: String(initialData.openingWarehouseId || '').trim(),
        openingQty: Number.isFinite(Number(initialData.openingQty))
          ? Number(initialData.openingQty)
          : Number.isFinite(Number(initialData.stock))
            ? Number(initialData.stock)
            : 0,
        /*
         * Why an item can have no GST rate and still be right.
         *
         * A rate of zero used to mean two different things — exempt, and nobody
         * filled it in — and the return cannot tell them apart. Taxability says
         * which, and only a taxable item is asked for a rate at all.
         */
        taxability: String(initialData.taxability || 'Taxable'),
        isActive: initialData.isActive !== false,
        trackInventory: initialData.trackInventory !== false,
        openingRate: Number.isFinite(Number(initialData.openingRate)) ? Number(initialData.openingRate) : 0,
        openingDate: String(initialData.openingDate || '').slice(0, 10),
        openingBranchId: String(initialData.openingBranchId || '').trim(),
      };
    }

    return {
      code: nextItemCode(db, currentCompany, 'Goods'),
      name: String(defaultName || ''),
      description: '',
      category: '',
      type: 'Goods',
      unit: 'Pcs',
      hsnSac: '',
      gstRate: 0,
      salePrice: 0,
      purchasePrice: 0,
      mrp: '',
      trackingType: 'NONE',
      barcode: '',
      reorderLevel: '',
      openingQty: 0,
      taxability: 'Taxable',
      /* Active from the moment it is made. */
      isActive: true,
      trackInventory: true,
      openingRate: 0,
      openingDate: '',
      // Opening stock has to land somewhere. The branch and warehouse the user
      // is already scoped to are the right guess; both stay editable.
      openingBranchId: String(localStorage.getItem('activeBranchId') || '').trim(),
      openingWarehouseId: String(localStorage.getItem('activeWarehouseId') || '').trim(),
    };
  });

  // Categories come from the master; an item that still carries a hand-typed
  // one keeps it, and a new one can be added without leaving this form.
  // The form opens with a snapshot of the book, so a category added from here
  // is remembered locally too — otherwise it would read as "not in the master"
  // until the form is reopened.
  const [addedCategories, setAddedCategories] = useState([]);
  const categoryNames = useMemo(() => {
    const fromMaster = (db.itemCategories || [])
      .filter((c) => c.companyId === currentCompany.id)
      .map((c) => String(c.name || '').trim())
      .filter(Boolean);
    return [...new Set([...fromMaster, ...addedCategories])].sort((a, b) => a.localeCompare(b));
  }, [db.itemCategories, currentCompany.id, addedCategories]);

  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDescription, setNewCategoryDescription] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const closeCategoryDrawer = () => {
    setNewCategoryOpen(false);
    setNewCategoryName('');
    setNewCategoryDescription('');
  };

  const saveNewCategory = async () => {
    const name = String(newCategoryName || '').trim();
    if (!name) {
      notify.error('Category name is required');
      return;
    }
    const exists = (db.itemCategories || []).some(
      (c) => c.companyId === currentCompany.id && String(c.name || '').trim().toLowerCase() === name.toLowerCase()
    );
    if (exists) {
      notify.error('That category already exists. Select it from the list.');
      return;
    }
    const description = String(newCategoryDescription || '').trim();
    setSavingCategory(true);
    try {
      const serverPatch = await saveMaster('itemCategories', name, { description });
      setDb((prev) => {
        const nextId = Math.max(0, ...(prev.itemCategories || []).map((c) => Number(c.id) || 0)) + 1;
        return {
          ...prev,
          itemCategories: [
            ...(prev.itemCategories || []),
            { id: nextId, companyId: currentCompany.id, name, description, ...serverPatch },
          ],
        };
      });
      setAddedCategories((prev) => (prev.includes(name) ? prev : [...prev, name]));
      setFormData((prev) => ({ ...prev, category: name }));
      closeCategoryDrawer();
      notify.success(`Category "${name}" created.`);
    } finally {
      setSavingCategory(false);
    }
  };

  const trackingValue = String(formData.trackingType || 'NONE');
  const batchEnabled = trackingValue === 'BATCH' || trackingValue === 'BATCH_EXPIRY';

  const uoms = (db.uoms || [])
    .filter((u) => u.companyId === currentCompany.id)
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const uomNames = uoms.map((u) => String(u.name || '').trim()).filter(Boolean);
  const unitValue = String(formData.unit ?? '').trim();

  const [newUnitOpen, setNewUnitOpen] = useState(false);
  const [newUnitName, setNewUnitName] = useState('');
  const [newUnitDescription, setNewUnitDescription] = useState('');
  const [savingUnit, setSavingUnit] = useState(false);
  const closeUnitDrawer = () => {
    setNewUnitOpen(false);
    setNewUnitName('');
    setNewUnitDescription('');
  };
  const saveNewUnit = async () => {
    const name = String(newUnitName || '').trim();
    if (!name) {
      notify.error('Unit name is required');
      return;
    }
    const exists = (db.uoms || []).some(
      (u) => u.companyId === currentCompany.id && String(u.name || '').trim().toLowerCase() === name.toLowerCase()
    );
    if (exists) {
      notify.error('This unit already exists. Select it from the list.');
      return;
    }
    const description = String(newUnitDescription || '').trim();
    setSavingUnit(true);
    try {
      const serverPatch = await saveMaster('uoms', name, { description });
      setDb((prev) => {
        const nextUomId = Math.max(0, ...(prev.uoms || []).map((u) => Number(u.id) || 0)) + 1;
        return {
          ...prev,
          uoms: [
            ...(prev.uoms || []),
            { id: nextUomId, companyId: currentCompany.id, name, description, createdAt: new Date().toISOString(), ...serverPatch },
          ],
        };
      });
      setFormData((p) => ({ ...p, unit: name }));
      closeUnitDrawer();
      notify.success(`Unit "${name}" created.`);
    } finally {
      setSavingUnit(false);
    }
  };

  const gstRates = (db.gstRates || [])
    .filter((r) => r.companyId === currentCompany.id)
    .slice()
    .sort((a, b) => Number(a.rate) - Number(b.rate));
  const gstRateValue = String(formData.gstRate ?? 0);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const code = String(formData.code || '').trim();
    const name = String(formData.name || '').trim();

    const gstRate = parseFloat(String(formData.gstRate ?? '0'));
    const salePrice = parseFloat(String(formData.salePrice ?? '0'));
    const purchasePrice = parseFloat(String(formData.purchasePrice ?? '0'));
    const mrp = parseFloat(String(formData.mrp ?? '0'));
    const openingQty = parseFloat(String(formData.openingQty ?? '0'));

    const clash = (db.items || []).some(
      (it) =>
        it.companyId === currentCompany.id &&
        String(it.code || '').trim().toLowerCase() === code.toLowerCase() &&
        (!isEdit || String(it.id) !== String(initialData?.id))
    );
    // Both blanks and the clash reported together, at their own fields.
    itemErrors.reset();
    itemErrors.require('code', code, 'Item code is required');
    itemErrors.check('code', !code || !clash, 'That code is already used by another item.');
    itemErrors.require('name', name, 'Item name is required');

    /*
     * Opening stock has to be somewhere.
     *
     * A quantity with no branch and no warehouse is stock the availability
     * check cannot see and the valuation cannot place — it used to be allowed
     * and became a number that existed nowhere. Only asked for when there is
     * actually an opening quantity to record.
     */
    const wantsOpening =
      String(formData.type || '').toLowerCase() === 'goods' &&
      formData.trackInventory !== false &&
      Number(formData.openingQty) > 0;

    if (wantsOpening) {
      itemErrors.require('openingBranchId', String(formData.openingBranchId || '').trim(), 'Choose the branch this stock is in');
      itemErrors.require(
        'openingWarehouseId',
        String(formData.openingWarehouseId || '').trim(),
        'Choose the warehouse this stock is in'
      );
    }

    if (itemErrors.failed()) return;

    if (isEdit) {
      const existing = (db.items || []).find((it) => it.companyId === currentCompany.id && String(it.id) === String(initialData?.id));
      if (!existing) {
        notify.error('Item not found. It may have been removed.');
        onClose?.();
        return;
      }

      const updated = {
        ...existing,
        companyId: currentCompany.id,
        code,
        name,
        description: String(formData.description || '').trim(),
        category: String(formData.category || '').trim(),
        type: formData.type,
        unit: formData.unit,
        hsnSac: String(formData.hsnSac || ''),
        gstRate: Number.isFinite(gstRate) ? gstRate : 0,
        salePrice: Number.isFinite(salePrice) ? salePrice : 0,
        purchasePrice: Number.isFinite(purchasePrice) ? purchasePrice : 0,
        mrp: Number.isFinite(mrp) && mrp > 0 ? mrp : null,
        trackingType: formData.trackingType || 'NONE',
        barcode: String(formData.barcode || '').trim(),
        reorderLevel: Number(formData.reorderLevel) > 0 ? Number(formData.reorderLevel) : null,
        openingQty: Number.isFinite(openingQty) ? Math.max(0, openingQty) : 0,
        openingWarehouseId: String(formData.openingWarehouseId || '').trim(),
        /*
         * What the item is for tax, not merely what its rate is. Exempt, nil
         * rated and non-GST are three different lines on a return and none of
         * them is a rate of zero — which is what they all used to be stored as.
         */
        taxability: String(formData.taxability || 'Taxable'),
        trackInventory: String(formData.type || '').toLowerCase() === 'goods' ? formData.trackInventory !== false : false,
        openingRate: Number(formData.openingRate) > 0 ? round2(Number(formData.openingRate)) : 0,
        openingValue: round2(Number(formData.openingQty || 0) * Number(formData.openingRate || 0)),
        openingDate: String(formData.openingDate || '').slice(0, 10),
        openingBranchId: String(formData.openingBranchId || '').trim(),
        isActive: formData.isActive !== false,
        // keep legacy field in sync (older screens/data)
        stock: Number.isFinite(openingQty) ? Math.max(0, openingQty) : Number(existing?.stock ?? 0) || 0,
      };

      setDb({
        ...db,
        items: db.items.map((it) => (it.companyId === currentCompany.id && String(it.id) === String(existing.id) ? updated : it)),
      });
      onClose?.();
      notify.success('Item updated!');
      return;
    }

    const nextId = Math.max(0, ...(db.items || []).map((i) => Number(i.id) || 0)) + 1;
    const newItem = {
      id: nextId,
      companyId: currentCompany.id,
      code,
      name,
      description: String(formData.description || '').trim(),
      category: String(formData.category || '').trim(),
      type: formData.type,
      unit: formData.unit,
      hsnSac: String(formData.hsnSac || ''),
      gstRate: Number.isFinite(gstRate) ? gstRate : 0,
      salePrice: Number.isFinite(salePrice) ? salePrice : 0,
      purchasePrice: Number.isFinite(purchasePrice) ? purchasePrice : 0,
      mrp: Number.isFinite(mrp) && mrp > 0 ? mrp : null,
      trackingType: formData.trackingType || 'NONE',
      barcode: String(formData.barcode || '').trim(),
      reorderLevel: Number(formData.reorderLevel) > 0 ? Number(formData.reorderLevel) : null,
      openingQty: Number.isFinite(openingQty) ? Math.max(0, openingQty) : 0,
      openingWarehouseId: String(formData.openingWarehouseId || '').trim(),
      /* What the item is for tax, not merely what its rate is — see the edit
         path above for why a rate of zero could not carry this. */
      taxability: String(formData.taxability || 'Taxable'),
      trackInventory: String(formData.type || '').toLowerCase() === 'goods' ? formData.trackInventory !== false : false,
      openingRate: Number(formData.openingRate) > 0 ? round2(Number(formData.openingRate)) : 0,
      openingValue: round2(Number(formData.openingQty || 0) * Number(formData.openingRate || 0)),
      openingDate: String(formData.openingDate || '').slice(0, 10),
      openingBranchId: String(formData.openingBranchId || '').trim(),
      /* A new item is in use from the moment it is made; retiring one is a
         later decision, taken from the menu on the form that edits it. */
      isActive: true,
      stock: Number.isFinite(openingQty) ? Math.max(0, openingQty) : 0,
    };

    /*
     * Written through, like the same item created from an invoice line.
     *
     * This screen used to save to the browser only, so whether a company's
     * catalogue survived a change of machine depended on which screen the item
     * was typed into. Hydration matches on `backendItemId`, so an item without
     * one is invisible to it.
     */
    const serverPatch = await saveItemToServer(newItem);

    const created = { ...newItem, ...serverPatch };
    setDb({
      ...db,
      items: [...db.items, created],
      // Advance the series so the next item of this type does not offer the
      // number this one just took.
      companies: bumpItemCodeSeries(db, currentCompany, newItem.type, newItem.code),
    });
    onCreated?.(created);
    onClose?.();
    notify.success('Item created!');
  };

  /*
   * What the form asks for follows what the item is.
   *
   * A service has no stock, so it has no inventory section at all; an item
   * nobody counts has no opening balance; and an exempt item has no GST rate,
   * because a rate of zero and "exempt" are different answers that a return
   * cannot tell apart afterwards.
   */
  const isGoods = String(formData.type || '').toLowerCase() === 'goods';
  const isTaxable = String(formData.taxability || 'Taxable') === 'Taxable';
  const tracksStock = isGoods && formData.trackInventory !== false;

  /* Warehouses belong to branches: choosing a branch narrows the list, and a
     warehouse from another branch is not a place this stock can be. */
  const branchList = Array.isArray(branches) ? branches : [];
  const openingBranchId = String(formData.openingBranchId || '').trim();
  const warehousesForOpening = (Array.isArray(warehouses) ? warehouses : []).filter(
    (w) => !openingBranchId || String(w?.branchId || '') === openingBranchId
  );

  const openingValue = round2(Number(formData.openingQty || 0) * Number(formData.openingRate || 0));

  const fields = (
    <>
      <FormSection
        icon={FileText}
        title="Basic Details"
        description="Enter the essential information about the item."
        className="item-master-section"
      >
        {/*
          One grid, both halves placed on its rows, so each field sits opposite
          its pair. Stacked as two columns, a caption under the item code pushed
          the category down past the item type and every row below it drifted —
          the two sides ended up describing different rows at the same height.
        */}
        <div className="grid gap-x-6 gap-y-3 lg:grid-cols-2">
            <ItemFormRow className="lg:col-start-1 lg:row-start-1" label="Item Name" required htmlFor="item-name">
              <input
                id="item-name"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="ui-input w-full"
                placeholder="Enter item name"
                required
              />
              <FieldError error={itemErrors.error('name')} id={itemErrors.errorId('name')} />
            </ItemFormRow>

            <ItemFormRow className="lg:col-start-1 lg:row-start-2" label="Item Type" required hint="Goods are counted and can carry stock; a service is not.">
              <div className="flex items-center gap-6 pt-1.5">
                {['Goods', 'Service'].map((t) => (
                  <label key={t} className="inline-flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="itemType"
                      className="ui-radio"
                      checked={String(formData.type) === t}
                      onChange={() => {
                        /* The code series follows the type, so it is re-minted
                           here rather than left from the other one. */
                        setFormData((p) => ({
                          ...p,
                          type: t,
                          code: isEdit ? p.code : nextItemCode(db, currentCompany, t),
                        }));
                      }}
                    />
                    {t}
                  </label>
                ))}
              </div>
            </ItemFormRow>

            <ItemFormRow className="lg:col-start-1 lg:row-start-3" label="HSN / SAC" required={isTaxable} htmlFor="item-hsn" hint="The code the rate is filed under.">
              <input
                id="item-hsn"
                type="text"
                value={formData.hsnSac}
                onChange={(e) => setFormData({ ...formData, hsnSac: e.target.value })}
                className="ui-input ui-mono w-full"
                placeholder="Enter HSN / SAC code"
              />
            </ItemFormRow>

            <ItemFormRow className="lg:col-start-1 lg:row-start-4"
              label="Taxability"
              required
              htmlFor="item-taxability"
              hint="Exempt, nil rated and non-GST are distinct GST treatments."
            >
              <select
                id="item-taxability"
                value={formData.taxability || 'Taxable'}
                onChange={(e) => setFormData({ ...formData, taxability: e.target.value })}
                className="ui-select w-full"
              >
                {['Taxable', 'Exempt', 'Nil Rated', 'Non-GST'].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </ItemFormRow>

            <ItemFormRow className="lg:col-start-1 lg:row-start-5" label="Purchase Price" htmlFor="item-purchase">
              <div className="relative">
                <span className="ui-subtle pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm">₹</span>
                <input
                  id="item-purchase"
                  type="number"
                  step="0.01"
                  value={formData.purchasePrice}
                  onChange={(e) => setFormData({ ...formData, purchasePrice: e.target.value })}
                  className="ui-input ui-money w-full ps-7"
                  placeholder="0.00"
                />
              </div>
            </ItemFormRow>

            <ItemFormRow className="lg:col-start-1 lg:row-start-6" label="MRP" htmlFor="item-mrp">
              <div className="relative">
                <span className="ui-subtle pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm">₹</span>
                <input
                  id="item-mrp"
                  type="number"
                  step="0.01"
                  value={formData.mrp}
                  onChange={(e) => setFormData({ ...formData, mrp: e.target.value })}
                  className="ui-input ui-money w-full ps-7"
                  placeholder="0.00"
                />
              </div>
            </ItemFormRow>

            <ItemFormRow className="lg:col-start-2 lg:row-start-1" label="Item Code" htmlFor="item-code" hint="Automatically allotted.">
              <input
                id="item-code"
                type="text"
                value={formData.code}
                readOnly
                aria-readonly="true"
                className="ui-input ui-mono w-full cursor-not-allowed"
                placeholder="No codes available"
              />
            </ItemFormRow>

            <ItemFormRow className="lg:col-start-2 lg:row-start-2" label="Category / Item Group">
              <PopupSelect
                ariaLabel="Category / Item Group"
                title="categories"
                value={formData.category || ''}
                onChange={(category) => setFormData((prev) => ({ ...prev, category }))}
                options={categoryNames.map((name) => ({ value: name, label: name }))}
                placeholder="Search or select category"
                alwaysSearch
                actionText="+ Create new category"
                onAction={() => setNewCategoryOpen(true)}
                icon={null}
              />
            </ItemFormRow>

            <ItemFormRow className="lg:col-start-2 lg:row-start-3" label="Unit of Measurement" required>
              <PopupSelect
                ariaLabel="Unit of Measurement"
                title="units"
                value={unitValue}
                onChange={(unit) => setFormData((prev) => ({ ...prev, unit }))}
                options={[
                  ...(unitValue && !uomNames.includes(unitValue) ? [{ value: unitValue, label: unitValue }] : []),
                  ...uoms.map((u) => ({ value: u.name, label: u.name })),
                ]}
                placeholder="Search or select unit"
                alwaysSearch
                actionText="+ Create new unit"
                onAction={() => setNewUnitOpen(true)}
                icon={null}
              />
            </ItemFormRow>

            {/* Only a taxable item is asked for a rate; the other three
                taxabilities answer the question by themselves. */}
            {isTaxable ? (
              <ItemFormRow
                className="lg:col-start-2 lg:row-start-4"
                label="GST Rate"
                required
                htmlFor="item-gst"
              >
                <select
                  id="item-gst"
                  value={gstRateValue}
                  onChange={(e) => setFormData({ ...formData, gstRate: Number(e.target.value) })}
                  className="ui-select w-full"
                >
                  {gstRates.length === 0 ? (
                    <option value="0">No rates in the master</option>
                  ) : (
                    gstRates.map((r) => (
                      <option key={r.id ?? r.rate} value={String(Number(r.rate))}>
                        {Number(r.rate)}%
                      </option>
                    ))
                  )}
                </select>
              </ItemFormRow>
            ) : null}

            <ItemFormRow className="lg:col-start-2 lg:row-start-5" label="Selling Price" htmlFor="item-sale">
              <div className="relative">
                <span className="ui-subtle pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm">₹</span>
                <input
                  id="item-sale"
                  type="number"
                  step="0.01"
                  value={formData.salePrice}
                  onChange={(e) => setFormData({ ...formData, salePrice: e.target.value })}
                  className="ui-input ui-money w-full ps-7"
                  placeholder="0.00"
                />
              </div>
            </ItemFormRow>
        </div>
      </FormSection>

      <Drawer open={newCategoryOpen} onClose={closeCategoryDrawer} title="New category" widthClass="w-[min(26rem,92vw)]">
        <div className="space-y-4">
          <div>
            <label className="ui-label" htmlFor="item-new-category">Category name <span className="text-[rgb(var(--neg))]">*</span></label>
            <input id="item-new-category" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} className="ui-input mt-1 w-full" placeholder="e.g. Beverages" autoFocus />
          </div>
          <div>
            <label className="ui-label" htmlFor="item-new-category-description">Description</label>
            <textarea id="item-new-category-description" rows={3} value={newCategoryDescription} onChange={(e) => setNewCategoryDescription(e.target.value)} className="ui-input mt-1 w-full resize-none" placeholder="Optional description" />
          </div>
          <div className="flex justify-end gap-2 border-t pt-4">
            <button type="button" onClick={closeCategoryDrawer} className="ui-btn ui-btn-secondary">Close</button>
            <button type="button" onClick={saveNewCategory} disabled={savingCategory} className="ui-btn ui-btn-primary">{savingCategory ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </Drawer>

      <Drawer open={newUnitOpen} onClose={closeUnitDrawer} title="New unit" widthClass="w-[min(26rem,92vw)]">
        <div className="space-y-4">
          <div>
            <label className="ui-label" htmlFor="item-new-unit">Unit name <span className="text-[rgb(var(--neg))]">*</span></label>
            <input id="item-new-unit" value={newUnitName} onChange={(e) => setNewUnitName(e.target.value)} className="ui-input mt-1 w-full" placeholder="e.g. Pcs, Kg, Hours" autoFocus />
          </div>
          <div>
            <label className="ui-label" htmlFor="item-new-unit-description">Description</label>
            <textarea id="item-new-unit-description" rows={3} value={newUnitDescription} onChange={(e) => setNewUnitDescription(e.target.value)} className="ui-input mt-1 w-full resize-none" placeholder="Optional description" />
          </div>
          <div className="flex justify-end gap-2 border-t pt-4">
            <button type="button" onClick={closeUnitDrawer} className="ui-btn ui-btn-secondary">Close</button>
            <button type="button" onClick={saveNewUnit} disabled={savingUnit} className="ui-btn ui-btn-primary">{savingUnit ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </Drawer>

      {/* A service is not counted, so none of this applies to one. */}
      {isGoods ? (
        <FormSection
          icon={Package}
          title="Inventory Details"
          description="Configure stock settings for goods."
          className="item-master-section"
        >
          <div className="space-y-3">
            <PartyFormRow label="Track Inventory" hint="Turn off when this item does not need quantity tracking.">
              <div className="flex items-center gap-6 pt-1.5">
                {[
                  { v: true, l: 'Yes' },
                  { v: false, l: 'No' },
                ].map((o) => (
                  <label key={o.l} className="inline-flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="trackInventory"
                      className="ui-radio"
                      checked={formData.trackInventory !== false === o.v}
                      onChange={() =>
                        setFormData({
                          ...formData,
                          trackInventory: o.v,
                          trackingType: o.v ? formData.trackingType : 'NONE',
                        })
                      }
                    />
                    {o.l}
                  </label>
                ))}
              </div>
            </PartyFormRow>

            {tracksStock ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="ui-label" htmlFor="item-open-qty">Opening Stock</label>
                    <input
                      id="item-open-qty"
                      type="number"
                      step="0.001"
                      value={formData.openingQty}
                      onChange={(e) => setFormData({ ...formData, openingQty: e.target.value })}
                      className="ui-input ui-money w-full"
                      placeholder="0.00"
                    />
                  </div>

                  <div>
                    <label className="ui-label" htmlFor="item-open-rate">Opening Stock Rate</label>
                    <div className="relative">
                      <span className="ui-subtle pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm">₹</span>
                      <input
                        id="item-open-rate"
                        type="number"
                        step="0.01"
                        value={formData.openingRate}
                        onChange={(e) => setFormData({ ...formData, openingRate: e.target.value })}
                        className="ui-input ui-money w-full ps-7"
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div>
                    <span className="ui-label inline-flex items-center gap-1.5">
                      Opening Stock Value
                      <span
      title="Quantity times rate. Typed by hand it would disagree with the stock it values."
                        aria-label="Quantity times rate. Typed by hand it would disagree with the stock it values."
                        className="ui-subtle inline-flex cursor-help"
                      >
                        <Info size={14} aria-hidden="true" />
                      </span>
                    </span>
                    <output className="ui-input ui-money ui-sunken mt-0 flex w-full items-center" aria-live="polite">
                      {formatMoney(openingValue, currentCompany)}
                    </output>
                  </div>

                  <div>
                    <label className="ui-label" htmlFor="item-open-date">Opening Stock Date</label>
                    <input
                      id="item-open-date"
                      type="date"
                      value={formData.openingDate}
                      onChange={(e) => setFormData({ ...formData, openingDate: e.target.value })}
                      className="ui-input w-full"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="ui-label" htmlFor="item-open-branch">
                      Branch <span style={{ color: 'rgb(var(--neg))' }}>*</span>
                    </label>
                    <select
                      id="item-open-branch"
                      value={openingBranchId}
                      onChange={(e) =>
                        /* The warehouse goes with it: one belonging to the
                           branch you just left is not a place this stock is. */
                        setFormData({ ...formData, openingBranchId: e.target.value, openingWarehouseId: '' })
                      }
                      className="ui-select w-full"
                    >
                      <option value="">Select branch</option>
                      {branchList.map((b) => (
                        <option key={b.id} value={String(b.id)}>
                          {b.branchCode ? `${b.branchCode} - ${b.branchName || ''}`.trim() : b.branchName || `Branch ${b.id}`}
                        </option>
                      ))}
                    </select>
                    <FieldError error={itemErrors.error('openingBranchId')} id={itemErrors.errorId('openingBranchId')} />
                  </div>

                  <div>
                    <label className="ui-label" htmlFor="item-open-warehouse">
                      Warehouse <span style={{ color: 'rgb(var(--neg))' }}>*</span>
                    </label>
                    <select
                      id="item-open-warehouse"
                      value={String(formData.openingWarehouseId || '')}
                      onChange={(e) => setFormData({ ...formData, openingWarehouseId: e.target.value })}
                      className="ui-select w-full"
                      disabled={!openingBranchId}
                    >
                      <option value="">{openingBranchId ? 'Select warehouse' : 'Choose a branch first'}</option>
                      {warehousesForOpening.map((w) => (
                        <option key={w.id} value={String(w.id)}>{w.name || `Warehouse ${w.id}`}</option>
                      ))}
                    </select>
                    <FieldError error={itemErrors.error('openingWarehouseId')} id={itemErrors.errorId('openingWarehouseId')} />
                  </div>
                  <div>
                    <label className="ui-label" htmlFor="item-reorder">Reorder level</label>
                    <input
                      id="item-reorder"
                      type="number"
                      value={formData.reorderLevel}
                      onChange={(e) => setFormData({ ...formData, reorderLevel: e.target.value })}
                      className="ui-input ui-money w-full"
                      placeholder="0"
                    />
                  </div>
                </div>
              </>
            ) : null}

            {tracksStock && batchCapable ? (
              <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border-t pt-3" style={{ borderColor: 'rgb(var(--border))' }}>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="ui-checkbox"
                    checked={batchEnabled}
                    onChange={(e) => setFormData({ ...formData, trackingType: e.target.checked ? 'BATCH' : 'NONE' })}
                  />
                  <span>
                    Track batches
                  </span>
                </label>
                <label className={`flex items-center gap-2 text-sm ${batchEnabled ? 'cursor-pointer' : 'ui-subtle cursor-not-allowed'}`}>
                  <input
                    type="checkbox"
                    className="ui-checkbox"
                    checked={formData.trackingType === 'BATCH_EXPIRY'}
                    disabled={!batchEnabled}
                    onChange={(e) => setFormData({ ...formData, trackingType: e.target.checked ? 'BATCH_EXPIRY' : 'BATCH' })}
                  />
                  <span>
                    Track expiry
                  </span>
                </label>
              </div>
            ) : null}
          </div>
        </FormSection>
      ) : null}

      {/* On a screen the bar at the top carries this; a second full-width
          button under the fields would be the same action twice. */}
      {fullPage ? null : (
        <button type="submit" className="w-full px-4 py-2 ui-btn ui-btn-primary rounded-lg">
          {isEdit ? 'Update Item' : 'Create Item'}
        </button>
      )}
    </>
  );

  /* A screen names itself and keeps its actions at the top; a dialog is already
     named by the dialog and keeps them at the foot. */
  return (
    <form onSubmit={handleSubmit} noValidate className={`item-master-form ${fullPage ? '' : 'space-y-4'}`}>
      {fullPage ? (
        <MasterFormPage
          title={isEdit ? 'Edit Item' : 'Create Item'}
          subtitle="Add or update the item details used in transactions."
          onBack={onClose}
          primaryLabel={isEdit ? 'Save Item' : 'Save Item'}
          /*
           * Custom fields always; active or inactive only once there is an item
           * to retire. A new one is active from the moment it is made, so
           * offering the switch on the create form asks a question whose answer
           * is already known.
           */
          menu={[
            ...(isEdit
              ? [
                  {
                    key: 'active',
                    label: formData.isActive === false ? 'Mark active' : 'Mark inactive',
                    onSelect: () => setFormData((p) => ({ ...p, isActive: !(p.isActive !== false) })),
                  },
                ]
              : []),
            { key: 'customFields', label: 'Custom fields', onSelect: () => onNavigate?.('settingsCustomFields') },
          ]}
        >
          {fields}
        </MasterFormPage>
      ) : (
        fields
      )}
    </form>
  );
};

export default ItemForm;
