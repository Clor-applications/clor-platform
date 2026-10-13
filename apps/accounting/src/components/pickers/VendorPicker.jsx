import { ENTITY_ICON } from '@ui/components/ui/entityIdentity';
import React from 'react';
import { Plus } from 'lucide-react';
import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { notify } from '@ui/components/ui/notify';
import Modal from '@ui/components/ui/Modal';
import Drawer from '@ui/components/ui/Drawer';
import Popover from '@ui/components/ui/Popover';
import { createVendor, listVendors, toServerCustomer } from '@ui/api/masters';
import { apiFetch } from '@platform/http';
import { useServerMasters, mirrorServerRows } from '@ui/hooks/useServerMasters';
import { GST_STATE_BY_CODE, getGstStateFromGstin } from '@ui/utils/gst';
import { getVendorDisplayName } from '@ui/utils/contacts';
import { activePriceListOptions, mergeGstinFetch, validateParty } from '@ui/utils/partyMaster';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import PartyFormLayout from './PartyFormLayout';
import { tdsPayableLedgers } from '@ui/utils/tdsLedgers';
import { VENDOR_CFG } from './partyFormConfig';
import { CUSTOMER_TABS } from './customerFormParts';
import { rankedSearch, soleConfidentMatch } from '@ui/utils/rankedSearch';
import { useListboxKeys, openOnKey, focusNextAfter } from '@ui/components/pickers/useListboxKeys';
import { useRecentPicks } from '@ui/components/pickers/useRecentPicks';
import { useRemoteSearch } from '@ui/components/pickers/useRemoteSearch';
import { nextVendorCode } from '@ui/utils/masterCodes';

export const VendorForm = ({ db, setDb, currentCompany, initialData = null, seedData = null, onCreated, onClose, onDuplicate = null }) => {
  const isEdit = Boolean(initialData);
  const branchOptions = (Array.isArray(db?.branches) ? db.branches : [])
    .filter((branch) => Number(branch?.companyId ?? currentCompany.id) === Number(currentCompany.id) && branch?.isActive !== false)
    .map((branch) => ({ value: String(branch.id), label: String(branch.name || branch.branchName || branch.code || branch.branchCode || `Branch ${branch.id}`) }));
  const multiBranchEnabled = branchOptions.length > 1;
  const INDIA_COUNTRY = 'India';
  const INDIA_STATES = Object.entries(GST_STATE_BY_CODE)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const allGroups = useMemo(() => {
    return (Array.isArray(db.accountGroups) ? db.accountGroups : [])
      .filter((g) => g.companyId === currentCompany.id)
      .filter((g) => !g.isLegacy)
      .slice();
  }, [db.accountGroups, currentCompany.id]);

  const sundryCreditorsGroup = useMemo(() => {
    return allGroups.find((g) => String(g.name || '').trim().toLowerCase() === 'sundry creditors') || null;
  }, [allGroups]);

  const [formData, setFormData] = useState(() => {
    const emptyAddress = {
      line1: '',
      line2: '',
      city: '',
      district: '',
      state: '',
      pincode: '',
      country: '',
    };

    if (initialData) {
      const billing = { ...emptyAddress, ...(initialData.billingAddress || {}) };
      const shipping = { ...emptyAddress, ...(initialData.shippingAddress || {}) };
      return {
        displayName: String(initialData.displayName || initialData.name || ''),
        groupId: initialData?.groupId ? String(initialData.groupId) : '',
        contactPerson: String(initialData.contactPerson || ''),
        mobile: String(initialData.mobile || initialData.phone || ''),
        email: String(initialData.email || ''),
        alternatePhone: String(initialData.alternatePhone || ''),
        gstRegistration: String(initialData.gstRegistration || 'Unregistered'),
        gstin: String(initialData.gstin || ''),
        pan: String(initialData.pan || ''),
        legalName: String(initialData.legalName || ''),
        tradeName: String(initialData.tradeName || ''),
        gstStatus: String(initialData.gstStatus || ''),
        gstTaxpayerType: String(initialData.gstTaxpayerType || ''),
        gstRegistrationDate: String(initialData.gstRegistrationDate || ''),
        currency: String(initialData.currency || 'INR'),
        /*
         * These three were absent from the edit branch, so opening the form on
         * an existing vendor rendered them from `undefined`: the opening
         * balance and the credit limit came up blank whatever the vendor
         * actually carried, and the balance type fell back to the customer's
         * Dr rather than a vendor's Cr.
         */
        openingBalance: Number(initialData.openingBalance ?? 0),
        openingBalanceType: String(initialData.openingBalanceType || 'Cr'),
        openingBalanceBranchId: String(initialData.openingBalanceBranchId || ''),
        creditLimit:
          initialData.creditLimit === undefined || initialData.creditLimit === null ? '' : String(initialData.creditLimit),
        priceListId: String(initialData.priceListId || ''),
        msmeRegistered:
          typeof initialData.msmeRegistered === 'boolean'
            ? initialData.msmeRegistered
            : Boolean(String(initialData.msmeNumber || '').trim()),
        msmeNumber: String(initialData.msmeNumber || ''),
        statutoryOther: String(initialData.statutoryOther || ''),
        tdsSection: String(initialData.tdsSection || ''),
        /* The party's TDS profile, read by the one engine every screen uses. */
        tdsApplicable: initialData.tdsApplicable,
        tdsNatureCode: String(initialData.tdsNatureCode || ''),
        tdsDeducteeType: String(initialData.tdsDeducteeType || 'COMPANY'),
        tdsResidentialStatus: String(initialData.tdsResidentialStatus || 'RESIDENT'),
        tdsCertificate: initialData.tdsCertificate && typeof initialData.tdsCertificate === 'object' ? initialData.tdsCertificate : null,
        tdsLedgerId: String(initialData.tdsLedgerId || ''),
        code: String(initialData.code || ''),
        isActive: initialData.isActive !== false,
        allowCreditNotes: initialData.allowCreditNotes !== false,
        contacts: Array.isArray(initialData.contacts) && initialData.contacts.length
          ? initialData.contacts
          : [{ name: '', position: '', email: '', mobile: '' }],
        shipToAddresses: Array.isArray(initialData.shipToAddresses) ? initialData.shipToAddresses : [],
        paymentTermDays:
          initialData.paymentTermDays === undefined || initialData.paymentTermDays === null
            ? ''
            : String(initialData.paymentTermDays),
        billingAddress: {
          ...billing,
          state: String(billing.state || ''),
          country: String(billing.country || INDIA_COUNTRY),
        },
        shippingSameAsBilling:
          typeof initialData.shippingSameAsBilling === 'boolean'
            ? initialData.shippingSameAsBilling
            : true,
        shippingAddress: {
          ...shipping,
          state: String(shipping.state || ''),
          country: String(shipping.country || INDIA_COUNTRY),
        },
      };
    }

    /*
     * "Duplicate this vendor": everything that describes the trading
     * relationship, none of the identity. A copied GSTIN or vendor code is a
     * second vendor claiming to be the first one.
     */
    if (seedData) {
      const billing = { ...emptyAddress, ...(seedData.billingAddress || {}) };
      return {
        ...seedData,
        id: undefined,
        accountId: undefined,
        backendPartyId: undefined,
        displayName: `${String(seedData.displayName || seedData.name || '').trim()} (copy)`.trim(),
        gstin: '',
        pan: '',
        code: '',
        openingBalance: 0,
        openingBalanceType: String(seedData.openingBalanceType || 'Cr'),
        openingBalanceBranchId: '',
        creditLimit:
          seedData.creditLimit === undefined || seedData.creditLimit === null ? '' : String(seedData.creditLimit),
        contacts: Array.isArray(seedData.contacts) && seedData.contacts.length
          ? seedData.contacts
          : [{ name: '', position: '', email: '', mobile: '' }],
        billingAddress: { ...billing, country: String(billing.country || INDIA_COUNTRY) },
        shippingSameAsBilling: true,
        shippingAddress: { ...billing, country: String(billing.country || INDIA_COUNTRY) },
      };
    }

    return {
      displayName: '',
      groupId: sundryCreditorsGroup?.id ? String(sundryCreditorsGroup.id) : '',
      openingBalance: isEdit ? Number(initialData?.openingBalance ?? 0) : 0,
      openingBalanceType: isEdit ? (initialData?.openingBalanceType || 'Cr') : 'Cr',
      openingBalanceBranchId: '',
      currency: 'INR',
      creditLimit: '',
      priceListId: '',
      msmeRegistered: false,
      msmeNumber: '',
      statutoryOther: '',
      tdsSection: '',
      tdsApplicable: undefined,
      tdsNatureCode: '',
      tdsDeducteeType: 'COMPANY',
      tdsResidentialStatus: 'RESIDENT',
      tdsCertificate: null,
      tdsLedgerId: '',
      code: '',
      isActive: true,
      /* Allowed unless somebody says otherwise: refusing notes is the exception. */
      allowCreditNotes: true,
      // One line ready to type into, as on the customer form.
      contacts: [{ name: '', position: '', email: '', mobile: '' }],
      shipToAddresses: [],
      contactPerson: '',
      mobile: '',
      email: '',
      alternatePhone: '',
      gstRegistration: 'Unregistered',
      gstin: '',
      pan: '',
      legalName: '',
      tradeName: '',
      gstStatus: '',
      gstTaxpayerType: '',
      gstRegistrationDate: '',
      paymentTermDays: '',
      billingAddress: {
        ...emptyAddress,
        country: INDIA_COUNTRY,
      },
      shippingSameAsBilling: true,
      shippingAddress: {
        ...emptyAddress,
        country: INDIA_COUNTRY,
      },
    };
  });

  // Default group, adjusted during render when it resolves after mount —
  // an effect here fires a second render pass for the same result.
  if (!isEdit && !String(formData.groupId || '').trim() && sundryCreditorsGroup?.id) {
    setFormData((p) => ({ ...p, groupId: String(sundryCreditorsGroup.id) }));
  }

  const vendorGroupOptions = useMemo(() => {
    const rootId = sundryCreditorsGroup?.id ? String(sundryCreditorsGroup.id) : '';
    const byId = new Map(allGroups.map((g) => [String(g.id), g]));
    const childrenByParent = new Map();
    for (const g of allGroups) {
      const pid = g?.parentGroupId !== null && g?.parentGroupId !== undefined ? String(g.parentGroupId) : '';
      if (!pid) continue;
      const arr = childrenByParent.get(pid) || [];
      arr.push(g);
      childrenByParent.set(pid, arr);
    }

    const isVendorCat = (g) => String(g?.groupCategory || '').trim() === 'Vendor';

    const ids = new Set();
    if (rootId && byId.get(rootId) && isVendorCat(byId.get(rootId))) ids.add(rootId);

    const queue = [];
    if (rootId) queue.push(rootId);
    while (queue.length) {
      const cur = queue.shift();
      const kids = childrenByParent.get(String(cur)) || [];
      for (const k of kids) {
        if (!isVendorCat(k)) continue;
        const kidId = String(k.id);
        if (ids.has(kidId)) continue;
        ids.add(kidId);
        queue.push(kidId);
      }
    }

    if (isEdit && String(formData.groupId || '').trim()) {
      const current = byId.get(String(formData.groupId));
      if (current && isVendorCat(current)) ids.add(String(current.id));
    }

    const rows = [...ids]
      .map((id) => byId.get(id))
      .filter(Boolean)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    if (rootId) {
      const root = byId.get(rootId);
      if (root) {
        const idx = rows.findIndex((r) => String(r.id) === rootId);
        if (idx > 0) {
          rows.splice(idx, 1);
          rows.unshift(root);
        }
      }
    }

    return rows.map((g) => ({ value: String(g.id), label: String(g.name || '').trim() }));
  }, [allGroups, sundryCreditorsGroup?.id, isEdit, formData.groupId]);

  const [groupCreateOpen, setGroupCreateOpen] = useState(false);
  const [groupDraftName, setGroupDraftName] = useState('');

  const createVendorChildGroup = (nameRaw) => {
    const name = String(nameRaw || '').trim();
    if (!name) return;
    if (!sundryCreditorsGroup?.id) {
      notify.error('Sundry Creditors group is missing.');
      return;
    }

    const clash = allGroups.some((g) => String(g.name || '').trim().toLowerCase() === name.toLowerCase());
    if (clash) {
      notify.error('Group already exists');
      return;
    }

    const nextId = allGroups.reduce((m, g) => Math.max(m, Number(g?.id || 0)), 0) + 1;
    const newGroup = {
      id: nextId,
      companyId: currentCompany.id,
      typeId: Number(sundryCreditorsGroup.typeId),
      name,
      parentGroupId: Number(sundryCreditorsGroup.id),
      groupCategory: 'Vendor',
      isUserDefined: true,
      createdAt: new Date().toISOString(),
    };

    setDb({
      ...db,
      accountGroups: [...(Array.isArray(db.accountGroups) ? db.accountGroups : []), newGroup],
    });

    setFormData((p) => ({ ...p, groupId: String(newGroup.id) }));
    setGroupCreateOpen(false);
    setGroupDraftName('');
  };

  const accountTypes = (Array.isArray(db.accountTypes) ? db.accountTypes : [])
    .filter((t) => t.companyId === currentCompany.id)
    .slice();
  const accountTypeById = new Map(accountTypes.map((t) => [String(t.id), t]));

  // Fetch from the GST portal. What comes back is a starting point, not a
  // verdict: everything it fills stays editable, because the portal's idea of
  // a trade name is often not what you call this vendor.
  const [gstFetching, setGstFetching] = useState(false);
  const [tab, setTab] = useState('address');
  const saveAndNewRef = useRef(false);

  /*
   * The lists this vendor may be put on. It was a free-text box with
   * "Standard" as a placeholder while the rate engine looks a list up by id,
   * so whatever was typed there matched nothing and the vendor was quietly on
   * default rates.
   */
  const priceListOptions = useMemo(
    () => activePriceListOptions({ db, companyId: currentCompany.id, onDate: new Date().toISOString().slice(0, 10) }),
    [db, currentCompany.id]
  );

  /*
   * The same row model the customer form uses: billing and shipping are the two
   * built-in places and everything after them is an extra. Written here rather
   * than shared because the two forms keep their own state — the layout is
   * shared, the state is not.
   */
  const VENDOR_COUNTRY = 'India';
  const addressRows = useMemo(
    () => [
      { key: 'BILLING', label: 'Billing', builtIn: true, ...formData.billingAddress },
      { key: 'SHIPPING', label: 'Shipping', builtIn: true, ...formData.shippingAddress },
      ...(formData.shipToAddresses || []).map((a, i) => ({
        key: `EXTRA-${i}`,
        builtIn: false,
        label: a.label || '',
        line1: a.line1 || '',
        line2: a.line2 || '',
        city: a.city || '',
        district: a.district || '',
        state: a.state || '',
        pincode: a.pincode || '',
        country: a.country || VENDOR_COUNTRY,
      })),
    ],
    [formData.billingAddress, formData.shippingAddress, formData.shipToAddresses]
  );

  const updateAddressRow = (i, key, value) =>
    setFormData((p) => {
      if (i === 0) {
        const billing = { ...p.billingAddress, [key]: value };
        /* Tied to billing, shipping is billing — including the edit being made
           now, or the two go out of step the moment somebody fixes a typo. */
        return p.shippingSameAsBilling
          ? { ...p, billingAddress: billing, shippingAddress: { ...billing } }
          : { ...p, billingAddress: billing };
      }
      if (i === 1) return { ...p, shippingAddress: { ...p.shippingAddress, [key]: value }, shippingSameAsBilling: false };
      const idx = i - 2;
      return { ...p, shipToAddresses: (p.shipToAddresses || []).map((a, j) => (j === idx ? { ...a, [key]: value } : a)) };
    });

  const addAddressRow = () =>
    setFormData((p) => ({
      ...p,
      shipToAddresses: [
        ...(p.shipToAddresses || []),
        { label: `Address ${(p.shipToAddresses || []).length + 3}`, line1: '', line2: '', city: '', district: '', state: '', pincode: '', country: VENDOR_COUNTRY },
      ],
    }));

  const removeAddressRow = (i) =>
    setFormData((p) => ({ ...p, shipToAddresses: (p.shipToAddresses || []).filter((_, j) => j !== i - 2) }));

  /*
   * Shipping is the billing address far more often than not, and retyping it is
   * how the two quietly diverge by a door number. Ticked, the shipping card
   * shows billing and stays with it; unticked, it keeps the copy it had and
   * becomes editable again.
   */
  const setShippingSameAsBilling = (on) =>
    setFormData((p) =>
      on
        ? { ...p, shippingAddress: { ...p.billingAddress }, shippingSameAsBilling: true }
        : { ...p, shippingSameAsBilling: false }
    );

  const updateContactRow = (i, key, value) =>
    setFormData((p) => ({ ...p, contacts: (p.contacts || []).map((c, j) => (j === i ? { ...c, [key]: value } : c)) }));

  const addContactRow = () =>
    setFormData((p) => ({ ...p, contacts: [...(p.contacts || []), { name: '', position: '', email: '', mobile: '' }] }));

  const removeContactRow = (i) => setFormData((p) => ({ ...p, contacts: (p.contacts || []).filter((_, j) => j !== i) }));

  /* One primary, or none. The flag is what a reminder is addressed to. */
  const setPrimaryContact = (i) =>
    setFormData((p) => ({
      ...p,
      contacts: (p.contacts || []).map((c, j) => ({ ...c, isPrimary: j === i })),
    }));

  const resetForm = () =>
    setFormData((p) => ({
      ...p,
      displayName: '', gstin: '', pan: '', code: '', openingBalance: 0, openingBalanceBranchId: '',
      msmeRegistered: false, msmeNumber: '', statutoryOther: '', priceListId: '', tdsSection: '',
      contacts: [{ name: '', position: '', email: '', mobile: '' }],
      shipToAddresses: [],
      billingAddress: { line1: '', line2: '', city: '', district: '', state: '', pincode: '', country: VENDOR_COUNTRY },
      shippingAddress: { line1: '', line2: '', city: '', district: '', state: '', pincode: '', country: VENDOR_COUNTRY },
    }));
  const fetchFromGstin = async () => {
    const gstin = normalizeGstin(formData.gstin);
    if (!isValidGstin(gstin)) {
      notify.error('Enter the full 15-character GSTIN first.');
      return;
    }
    setGstFetching(true);
    try {
      const data = await apiFetch(`/gstin/${gstin}`, { skipWarehouseHeader: true });
      /*
       * A fetch fills blanks. Anything already typed stays and the difference
       * is reported — the spec is explicit that a lookup must not silently
       * overwrite what somebody entered, and a name corrected to what the
       * business actually calls this supplier is the commonest casualty.
       */
      const { next, kept: keptFields } = mergeGstinFetch({ prev: formData, data: { ...data, gstin } });
      setFormData(next);
      if (keptFields.length) {
        notify.info(`Kept what you had typed for the ${keptFields.join(', ')}. Clear a field and fetch again to take the portal's version.`);
      }
      if (data.source === 'portal') {
        notify.success('Fetched from the GST portal — check the details and edit anything that is off.');
      } else {
        const why = String(data.note || data.error || '').trim();
        notify.info(why || 'Filled the state and PAN the GSTIN itself encodes.');
      }
    } catch (err) {
      const msg = String(err?.message || 'Could not reach the GST lookup service.');
      notify.error(msg);
    } finally {
      setGstFetching(false);
    }
  };
  const gstStateAuto = getGstStateFromGstin(formData.gstin);


  const normalizeGstin = (v) => String(v || '').trim().toUpperCase();
  const normalizePan = (v) => String(v || '').trim().toUpperCase();
  const getPanFromGstin = (gstin) => {
    const g = normalizeGstin(gstin);
    return g.length >= 12 ? g.slice(2, 12) : '';
  };
  const isValidPan = (pan) => /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(normalizePan(pan));
  const isValidGstin = (gstin) => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(normalizeGstin(gstin));
  const getGstinState = (gstin) => getGstStateFromGstin(normalizeGstin(gstin));

  const handleSubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    /* Which button was pressed: "Save and add another" keeps the form open. */
    const saveAndNew = saveAndNewRef.current;
    saveAndNewRef.current = false;

    const selectedGroupIdRaw = String(formData.groupId || '').trim();
    const effectiveGroupId = selectedGroupIdRaw
      ? Number(selectedGroupIdRaw)
      : sundryCreditorsGroup
        ? Number(sundryCreditorsGroup.id)
        : null;

    /*
     * What the master refuses, in one place and in the order a person meets
     * it. The tab a bad field sits on is opened rather than the message
     * pointing at somewhere invisible.
     */
    const complaint = validateParty({
      values: { ...formData, groupId: selectedGroupIdRaw || (sundryCreditorsGroup ? String(sundryCreditorsGroup.id) : '') },
      noun: 'Vendor',
      priceListOptions,
    });
    if (complaint) {
      if (complaint.tab) setTab(complaint.tab);
      notify.error(complaint.message);
      return;
    }
    if (multiBranchEnabled && Number(formData.openingBalance || 0) !== 0 && !String(formData.openingBalanceBranchId || '').trim()) {
      notify.error('Select the branch that carries this opening balance.');
      return;
    }

    const gstinNormalized = normalizeGstin(formData.gstin);
    const panNormalized = normalizePan(formData.pan);

    if (formData.msmeRegistered && !String(formData.msmeNumber || '').trim()) {
      setTab('statutory');
      notify.error('MSME / Udyam number is required for an MSME registered vendor.');
      return;
    }

    const gstRegistrationRequiresGstin = ['Registered', 'Composition', 'SEZ'].includes(formData.gstRegistration);

    const effectiveGstin = gstRegistrationRequiresGstin ? gstinNormalized : '';
    const panFromGstin = effectiveGstin ? getPanFromGstin(effectiveGstin) : '';
    const effectivePan = gstRegistrationRequiresGstin ? (panNormalized || panFromGstin) : '';

    if (!gstRegistrationRequiresGstin && gstinNormalized) {
      notify.error('GSTIN is not allowed when GST Registration is Unregistered/Overseas.');
      return;
    }
    if (gstRegistrationRequiresGstin && !effectiveGstin) {
      notify.error('GSTIN is required for the selected GST registration type');
      return;
    }

    if (effectiveGstin && !isValidGstin(effectiveGstin)) {
      notify.error('Please enter a valid GSTIN.');
      return;
    }

    if (gstRegistrationRequiresGstin) {
      if (!effectivePan) {
        notify.error('PAN is required for the selected GST registration type.');
        return;
      }
      if (!isValidPan(effectivePan)) {
        notify.error('Please enter a valid PAN.');
        return;
      }
      if (panFromGstin && normalizePan(effectivePan) !== normalizePan(panFromGstin)) {
        notify.error('PAN does not match GSTIN.');
        return;
      }
    }

    const billingCountry = String(formData.billingAddress?.country || '').trim();
    const billingState = String(formData.billingAddress?.state || '').trim();

    if (billingCountry === INDIA_COUNTRY && !billingState) {
      notify.error('Billing state is required for India.');
      return;
    }

    if (gstRegistrationRequiresGstin) {
      const stateFromGstin = getGstinState(effectiveGstin);
      if (!stateFromGstin) {
        notify.error('Unable to derive State from GSTIN. Please check GSTIN.');
        return;
      }
      if (
        billingCountry === INDIA_COUNTRY &&
        billingState &&
        String(stateFromGstin).trim().toLowerCase() !== String(billingState).trim().toLowerCase()
      ) {
        notify.error('Billing State does not match GSTIN State.');
        return;
      }
    }

    const billingStateFinal = String(gstStateAuto || formData.billingAddress.state || '').trim();

    const payloadBase = {
      companyId: currentCompany.id,
      ...formData,
      name: formData.displayName.trim(),
      // keep backward-compatible `phone` while using Customer-like `mobile`
      phone: String(formData.mobile || '').trim(),
      gstin: effectiveGstin,
      pan: effectivePan,
      creditLimit:
        String(formData.creditLimit ?? '').trim() === '' ? undefined : Math.max(0, Number(formData.creditLimit) || 0),
      // Stored as a number so the due-date maths never sees "30" as a string.
      paymentTermDays:
        String(formData.paymentTermDays ?? '').trim() === ''
          ? undefined
          : Math.min(365, Math.max(0, Math.trunc(Number(formData.paymentTermDays) || 0))),
      billingAddress: {
        ...formData.billingAddress,
        state: billingStateFinal,
        country: billingCountry || INDIA_COUNTRY,
      },
      shippingSameAsBilling: true,
      shippingAddress: {
        ...formData.billingAddress,
        state: billingStateFinal,
        country: billingCountry || INDIA_COUNTRY,
      },
    };

    if (isEdit) {
      const existing = (db.vendors || []).find(
        (v) => v.companyId === currentCompany.id && String(v.id) === String(initialData?.id)
      );
      if (!existing) {
        notify.error('Vendor not found. It may have been removed.');
        onClose?.();
        return;
      }

      const updatedVendor = {
        ...existing,
        ...payloadBase,
        balance: existing.balance || 0,
        groupId: effectiveGroupId,
      };

      const coa = Array.isArray(db.chartOfAccounts) ? db.chartOfAccounts : [];
      const groups = Array.isArray(db.accountGroups) ? db.accountGroups : [];
      const groupRow = effectiveGroupId
        ? groups.find((g) => Number(g.id) === Number(effectiveGroupId) && g.companyId === currentCompany.id)
        : null;
      const typeRow = groupRow ? accountTypeById.get(String(groupRow.typeId)) : null;

      const existingLedger = updatedVendor?.accountId
        ? coa.find((a) => a.companyId === currentCompany.id && String(a.id) === String(updatedVendor.accountId))
        : null;

      const nextCoaId = coa.reduce((m, a) => Math.max(m, Number(a?.id || 0)), 0) + 1;

      const ledgerName = getVendorDisplayName(updatedVendor);
      const ledgerCode = existingLedger?.code || `VEND-${updatedVendor.id}`;

      const upsertLedger = existingLedger
        ? {
            ...existingLedger,
            code: ledgerCode,
            name: ledgerName,
            ledgerCategory: 'Vendor',
            groupId: effectiveGroupId,
            type: String(typeRow?.accountClass || existingLedger.type || 'Liability'),
            subType: String(typeRow?.name || existingLedger.subType || ''),
            main: String(typeRow?.main || existingLedger.main || 'Balance Sheet'),
            openingBalance: Math.round((Number(formData.openingBalance) || 0) * 100) / 100,
            openingBalanceType: formData.openingBalanceType || 'Cr',
            openingBalanceBranchId: String(formData.openingBalanceBranchId || ''),
            updatedAt: new Date().toISOString(),
          }
        : {
            id: nextCoaId,
            companyId: currentCompany.id,
            code: ledgerCode,
            name: ledgerName,
            ledgerCategory: 'Vendor',
            groupId: effectiveGroupId,
            type: String(typeRow?.accountClass || 'Liability'),
            subType: String(typeRow?.name || ''),
            main: String(typeRow?.main || 'Balance Sheet'),
            balance: 0,
            openingBalance: Math.round((Number(formData.openingBalance) || 0) * 100) / 100,
            openingBalanceType: formData.openingBalanceType || 'Cr',
            openingBalanceBranchId: String(formData.openingBalanceBranchId || ''),
            createdAt: new Date().toISOString(),
          };

      const nextChartOfAccounts = existingLedger
        ? coa.map((a) => (a.companyId === currentCompany.id && String(a.id) === String(existingLedger.id) ? upsertLedger : a))
        : [...coa, upsertLedger];

      const finalVendor = {
        ...updatedVendor,
        accountId: existingLedger ? existingLedger.id : upsertLedger.id,
      };

      setDb({
        ...db,
        chartOfAccounts: nextChartOfAccounts,
        vendors: (db.vendors || []).map((v) =>
          v.companyId === currentCompany.id && String(v.id) === String(existing.id) ? finalVendor : v
        ),
      });

      if (typeof onCreated === 'function') onCreated(finalVendor);
      if (typeof onClose === 'function') {
        onClose();
        return;
      }
      notify.success('Vendor updated!');
      return;
    }

    const nextId = Math.max(0, ...(Array.isArray(db.vendors) ? db.vendors : []).map((v) => Number(v.id) || 0)) + 1;
    const newVendor = {
      id: nextId,
      ...payloadBase,
      balance: 0,
      groupId: effectiveGroupId,
    };

    const coa = Array.isArray(db.chartOfAccounts) ? db.chartOfAccounts : [];
    const groups = Array.isArray(db.accountGroups) ? db.accountGroups : [];
    const groupRow = effectiveGroupId
      ? groups.find((g) => Number(g.id) === Number(effectiveGroupId) && g.companyId === currentCompany.id)
      : null;
    const typeRow = groupRow ? accountTypeById.get(String(groupRow.typeId)) : null;

    const nextCoaId = coa.reduce((m, a) => Math.max(m, Number(a?.id || 0)), 0) + 1;
    const ledger = {
      id: nextCoaId,
      companyId: currentCompany.id,
      code: `VEND-${newVendor.id}`,
      name: getVendorDisplayName(newVendor),
      ledgerCategory: 'Vendor',
      groupId: effectiveGroupId,
      type: String(typeRow?.accountClass || 'Liability'),
      subType: String(typeRow?.name || ''),
      main: String(typeRow?.main || 'Balance Sheet'),
      balance: 0,
      openingBalance: Math.round((Number(formData.openingBalance) || 0) * 100) / 100,
      /* Cr, not Dr: a vendor balance is money the business owes. */
      openingBalanceType: formData.openingBalanceType || 'Cr',
      openingBalanceBranchId: String(formData.openingBalanceBranchId || ''),
      createdAt: new Date().toISOString(),
    };

    const finalVendor = { ...newVendor, accountId: ledger.id };

    /*
     * Write through to the server, then keep what it allotted.
     *
     * The customer form has done this since the master was rebuilt; the vendor
     * form never did. A vendor entered on the Vendors screen lived in one
     * browser: its contacts and extra addresses reached nothing, the code the
     * server allots stayed blank, and — because hydration matches a server
     * party to the local one by `backendPartyId` — signing in on a second
     * machine came back missing exactly the vendors the first machine had
     * typed, with the bills against them pointing at no party at all.
     *
     * Failure is not fatal: a vendor entered offline stays local and usable.
     */
    let serverPatch = {};
    try {
      const created = await createVendor(toServerCustomer(finalVendor));
      const party = created?.party;
      if (party?.id) serverPatch = { backendPartyId: String(party.id), code: party.code || finalVendor.code || '' };
    } catch (err) {
      notify.error(`Saved on this device only — the server refused it: ${String(err?.message || err)}`);
    }

    const storedVendor = { ...finalVendor, ...serverPatch };

    setDb({ ...db, chartOfAccounts: [...coa, ledger], vendors: [...(db.vendors || []), storedVendor] });

    if (typeof onCreated === 'function') onCreated(storedVendor);

    if (saveAndNew) {
      resetForm();
      setTab('address');
      notify.success('Vendor created. Ready for the next one.');
      return;
    }

    if (typeof onClose === 'function') {
      onClose();
      return;
    }

    notify.success('Vendor created!');
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="customer-create-form flex min-h-0 flex-col">
        <PartyFormLayout
          cfg={VENDOR_CFG}
          formData={formData}
          setFormData={setFormData}
          isEdit={isEdit}
          subtitle={isEdit ? String(initialData?.displayName || initialData?.name || '') : ''}
          onClose={onClose}
          resetForm={resetForm}
          saveAndNewRef={saveAndNewRef}
          tab={tab}
          setTab={setTab}
          tabs={CUSTOMER_TABS}
          tdsLedgerOptions={tdsPayableLedgers(db, currentCompany?.id)}
          groupOptions={vendorGroupOptions}
          onCreateGroup={(typed) => {
            setGroupDraftName(typed);
            setGroupCreateOpen(true);
          }}
          codesEnabled={true}
          automaticCode={isEdit ? String(formData.code || '') : nextVendorCode(db?.vendors)}
          priceListOptions={priceListOptions}
          branchOptions={branchOptions}
          multiBranchEnabled={multiBranchEnabled}
          baseCurrency={currentCompany?.currency || currentCompany?.baseCurrency || 'INR'}
          onDuplicate={isEdit && onDuplicate ? () => onDuplicate(formData) : null}
          gstinFetching={gstFetching}
          fetchFromGstin={fetchFromGstin}
          addressRows={addressRows}
          sameAsBilling={formData.shippingSameAsBilling === true}
          onSameAsBilling={setShippingSameAsBilling}
          updateAddressRow={updateAddressRow}
          addAddressRow={addAddressRow}
          removeAddressRow={removeAddressRow}
          updateContactRow={updateContactRow}
          addContactRow={addContactRow}
          removeContactRow={removeContactRow}
          setPrimaryContact={setPrimaryContact}
        />
      </form>

      {groupCreateOpen ? (
        <Modal
          onClose={() => {
            setGroupCreateOpen(false);
            setGroupDraftName('');
          }}
          title="New Group"
          maxWidthClass="max-w-xl"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createVendorChildGroup(groupDraftName);
            }}
            className="space-y-4"
          >
            <div>
              <label className="ui-label" htmlFor="vendorpicker-group-name">Group Name</label>
              <input id="vendorpicker-group-name"
                type="text"
                value={groupDraftName}
                onChange={(e) => setGroupDraftName(e.target.value)}
                className="ui-input w-full"
                placeholder="e.g., Local Suppliers"
                autoFocus
                required
              />
              <div className="text-xs ui-muted mt-1">
                This group will be created under Sundry Creditors.
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setGroupCreateOpen(false);
                  setGroupDraftName('');
                }}
                className="px-4 py-2 rounded-lg border ui-hover-sunken"
              >
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-lg ui-primary-bg">
                Create
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
};

const VendorPicker = ({
  db,
  setDb,
  currentCompany,
  value,
  onChange,
  label = 'Vendor',
  disabled = false,
  disabledHint = '',
  // Renders a "New" button beside the trigger, so creating a vendor is one
  // click from the form rather than hidden inside the select popup.
  showCreateButton = false,
  /* A lucide component drawn inside the trigger, before the name. Decorative:
     the label already says what the field is. */
  icon: LeadingIcon = ENTITY_ICON.vendor,
}) => {
  // Same pattern as the customer picker: server list, local fallback.
  const serverVendors = useServerMasters(
    useCallback((search) => listVendors(search).then((d) => d?.vendors || []), []),
    (db?.vendors || []).filter((v) => Number(v.companyId) === Number(currentCompany?.id))
  );

  // Server rows mirror into the local collection; the picker lists ONLY local
  // rows so every selection is a local numeric id (backendPartyId rides
  // along). This is what makes Number(partyId) checks downstream valid again.
  useEffect(() => {
    if (serverVendors.source !== 'server' || typeof setDb !== 'function') return;
    mirrorServerRows({
      setDb,
      collection: 'vendors',
      backendKey: 'backendPartyId',
      serverRows: serverVendors.rows,
      companyId: currentCompany?.id,
      mapRow: (srv) => ({
        name: srv.name || '',
        gstin: srv.gstin || '',
        gstRegistration: srv.gstRegistration || 'Unregistered',
        state: srv.state || srv.billingState || '',
        email: srv.email || '',
        mobile: srv.phone || srv.mobile || '',
        paymentTermDays: srv.paymentTermDays ?? null,
        createdAt: srv.createdAt || new Date().toISOString(),
      }),
    });
  }, [serverVendors.source, serverVendors.rows, setDb, currentCompany?.id]);

  const vendors = (db?.vendors || []).filter((c) => Number(c.companyId) === Number(currentCompany?.id));

  const findVendor = (id) =>
    vendors.find((v) => String(v.id) === String(id)) ||
    (db?.vendors || []).find((v) => String(v.id) === String(id));
  const triggerRef = useRef(null);
  const [showVendorPopup, setShowVendorPopup] = useState(false);
  const [vendorPopupMode, setVendorPopupMode] = useState('select');
  const [vendorSearch, setVendorSearch] = useState('');

  const selectedVendorName = value ? getVendorDisplayName(findVendor(value)) : '';

  const normalizedVendorSearch = vendorSearch.trim().toLowerCase();
  const recents = useRecentPicks('vendor', currentCompany?.id);

  // Above the page the server returns, typing has to reach the server or the
  // name may simply not be in the browser to find.
  useRemoteSearch(serverVendors.reload, vendorSearch, {
    localSize: vendors.length,
    enabled: showVendorPopup,
  });

  // Same ranking every list in the product uses: exact, then starts-with,
  // then a word inside the name, then GSTIN or phone, then a loose match.
  // Unfiltered, the vendors this operator actually buys from come first.
  const filteredVendors = normalizedVendorSearch
    ? rankedSearch(vendors, normalizedVendorSearch, {
        fields: (v) => [getVendorDisplayName(v), v.email, v.phone],
        codes: (v) => [v.gstin, v.pan, v.phone],
      })
    : recents.promote(vendors);

  // Focus goes back to the field that opened this, so the next Tab continues
  // the form instead of restarting at the top of the page.
  const closePopup = ({ advance = false, refocus = true } = {}) => {
    setShowVendorPopup(false);
    setVendorPopupMode('select');
    setVendorSearch('');
    /* `refocus: false` when the dismissal came from outside the field: pulling
       the caret back would reopen the list over whatever was just clicked. */
    if (!refocus) return;
    requestAnimationFrame(() => {
      // Choosing moves on; cancelling stays put. See focusNextAfter.
      if (advance) focusNextAfter(triggerRef.current);
      else triggerRef.current?.focus({ preventScroll: true });
    });
  };

  const chooseVendor = (vendor) => {
    if (!vendor) return;
    recents.remember(vendor.id);
    onChange(String(vendor.id));
    closePopup({ advance: true });
  };

  const openPopup = () => {
    if (disabled) return;
    setVendorPopupMode('select');
    setVendorSearch('');
    setShowVendorPopup(true);
  };

  const vendorSearchOpts = {
    fields: (v) => [getVendorDisplayName(v), v.email, v.phone],
    codes: (v) => [v.gstin, v.pan, v.phone],
  };

  /*
   * Tab out of the search box takes the one match, when there is exactly one.
   *
   * Requirement 15 says highlight without auto-selecting while somebody is
   * still typing; section 9 says a full code should not have to be confirmed.
   * Both hold at once if the selection happens on the way out of the field
   * rather than on every keystroke.
   */
  const onVendorSearchTab = (e) => {
    if (e.key !== 'Tab' || e.shiftKey) return;
    const sole = soleConfidentMatch(vendors, vendorSearch, vendorSearchOpts);
    if (!sole) return;
    // Swallow the Tab: the dialog's focus trap would otherwise move focus
    // inside a dialog that is closing on this very keystroke.
    e.preventDefault();
    e.stopPropagation();
    chooseVendor(sole);
  };

  const vendorRecentCount = normalizedVendorSearch ? 0 : recents.recentCount(filteredVendors);

  const {
    activeIndex: vendorActiveIndex,
    setActiveIndex: setVendorActiveIndex,
    listRef: vendorListRef,
    onKeyDown: onVendorListKeys,
  } = useListboxKeys({
    count: filteredVendors.length,
    onChoose: (i) => chooseVendor(filteredVendors[i]),
    onCancel: () => closePopup(),
    // Tab off a list nobody drove: leave the value alone and carry on,
    // rather than snapping back to the field just left.
    onTabOut: () => closePopup({ advance: true }),
  });

  return (
    /* One element, not a fragment: split across a grid, the label and the
       control land in different columns. */
    <div className="min-w-0">
      <label className="ui-label">{label}</label>
      <div className="flex items-center gap-2">
        {/* The same field the customer and item fields are: typed into, with
            the suggestions hanging off it. */}
        <div className="relative flex-1">
          {LeadingIcon ? (
            <LeadingIcon
              size={16}
              aria-hidden="true"
              className="ui-subtle pointer-events-none absolute start-3 top-1/2 -translate-y-1/2"
            />
          ) : null}
          <input
            ref={triggerRef}
            type="text"
            role="combobox"
            disabled={disabled}
      title={disabled ? disabledHint || 'Locked' : undefined}
            value={showVendorPopup ? vendorSearch : selectedVendorName}
            placeholder="Type a vendor name"
            onMouseDown={() => {
              /* A click or typing opens it — never focus alone, which arrives
                 as the list closes and would reopen it instantly. */
              if (disabled || showVendorPopup) return;
              setVendorPopupMode('select');
              setVendorSearch('');
              setShowVendorPopup(true);
            }}
            onChange={(e) => {
              if (disabled) return;
              if (!showVendorPopup) {
                setVendorPopupMode('select');
                setShowVendorPopup(true);
              }
              setVendorSearch(e.target.value);
              setVendorActiveIndex(0);
            }}
            onKeyDown={(e) => {
              if (disabled) return;
              if (!showVendorPopup) {
                openOnKey(openPopup)(e);
                return;
              }
              if (e.altKey && (e.key === 'c' || e.key === 'C')) {
                e.preventDefault();
                e.stopPropagation();
                setVendorPopupMode('create');
                return;
              }
              onVendorSearchTab(e);
              onVendorListKeys(e);
            }}
            aria-haspopup="listbox"
            aria-expanded={showVendorPopup}
            aria-autocomplete="list"
            aria-controls={showVendorPopup ? 'vendor-picker-list' : undefined}
            className={`ui-input w-full${LeadingIcon ? ' ps-9' : ''}${disabled ? ' opacity-60 cursor-not-allowed' : ''}`}
          />
        </div>
        {showCreateButton && !disabled ? (
          <button
            type="button"
            onClick={() => {
              setVendorPopupMode('create');
              setVendorSearch('');
              setShowVendorPopup(true);
            }}
            className="ui-btn ui-btn-secondary whitespace-nowrap"
          >
            + New Vendor
          </button>
        ) : null}
      </div>
      {disabled && disabledHint ? <div className="text-xs ui-muted mt-1">{disabledHint}</div> : null}

      {/* Suggestions stay beside the field. Creation uses the shared right-side
          workspace so a bill remains visible and intact behind the form. */}
      {showVendorPopup && vendorPopupMode === 'select' ? (
        <Popover
          anchorRef={triggerRef}
          onClose={() => closePopup({ refocus: false })}
          autoFocus={false}
          minWidth={320}
        >
          <div id="vendor-picker-list" ref={vendorListRef} role="listbox" className="max-h-80 overflow-y-auto p-1">
            {filteredVendors.length === 0 ? (
              <div className="px-3 py-4 text-sm ui-muted">
                {normalizedVendorSearch ? `No vendor matches “${vendorSearch.trim()}”.` : 'No vendors yet.'}
              </div>
            ) : (
              filteredVendors.map((v, i) => {
                const on = i === vendorActiveIndex;
                return (
                  <React.Fragment key={v.id}>
                    {/* The habitual rows, called what they are. */}
                    {vendorRecentCount && i === 0 ? (
                      <div className="ui-caption px-2 pt-1 pb-0.5">Recently used</div>
                    ) : null}
                    {vendorRecentCount && i === vendorRecentCount ? (
                      <div className="ui-caption px-2 pt-2 pb-0.5">All vendors</div>
                    ) : null}
                    <button
                      id={`vendor-opt-${v.id}`}
                      type="button"
                      role="option"
                      aria-selected={String(v.id) === String(value)}
                      data-active={on || undefined}
                      onMouseEnter={() => setVendorActiveIndex(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => chooseVendor(v)}
                      className={`w-full rounded-lg px-3 py-2 text-left ${on ? '' : 'ui-hover-sunken'}`}
                      style={
                        on
                          ? { backgroundColor: 'rgb(var(--brand))', color: 'rgb(var(--on-brand))' }
                          : undefined
                      }
                    >
                      <div className={`text-sm font-medium ${on ? '' : 'ui-fg'}`}>{getVendorDisplayName(v)}</div>
                      {(v.phone || v.gstin) && (
                        <div className={`text-xs truncate ${on ? 'opacity-80' : 'ui-muted'}`}>
                          {[v.phone, v.gstin].filter(Boolean).join(' • ')}
                        </div>
                      )}
                    </button>
                  </React.Fragment>
                );
              })
            )}
          </div>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setVendorPopupMode('create')}
            className="ui-hover-sunken flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm"
          >
            <Plus size={14} aria-hidden="true" />
            {normalizedVendorSearch ? `Create “${vendorSearch.trim()}”` : 'Create a new vendor'}
          </button>
        </Popover>
      ) : null}

      {showVendorPopup && vendorPopupMode === 'create' ? (
        <Drawer
          open
          onClose={() => closePopup()}
          title="Create Vendor"
          widthClass="ui-form-drawer"
        >
            <VendorForm
              db={db}
              setDb={setDb}
              currentCompany={currentCompany}
              onCreated={async (vendor) => {
                // Selecting the server id here made the selection a cuid, which
                // is NaN to every screen that resolves it with
                // Number(vendorId) against db.vendors — the vendor came back as
                // "Party (Vendor) is required". The local numeric id stays the
                // selection; backendPartyId carries the server identity for API
                // calls.
                try {
                  const created = await createVendor({
                    name: getVendorDisplayName(vendor) || vendor.name || 'Vendor',
                    gstin: vendor.gstin || undefined,
                    phone: vendor.mobile || vendor.phone || undefined,
                    email: vendor.email || undefined,
                    billingState: vendor.billingAddress?.state || undefined,
                    paymentTermDays:
                      vendor.paymentTermDays === undefined || vendor.paymentTermDays === null
                        ? undefined
                        : Number(vendor.paymentTermDays),
                  });
                  await serverVendors.reload();

                  const serverId = String(created?.party?.id || '').trim();
                  if (serverId && typeof setDb === 'function') {
                    setDb((prev) => ({
                      ...prev,
                      vendors: (Array.isArray(prev?.vendors) ? prev.vendors : []).map((v) =>
                        String(v.id) === String(vendor.id) ? { ...v, backendPartyId: serverId } : v
                      ),
                    }));
                  }
                } catch {
                  // Offline or refused: keep the local record so entry continues.
                }
                onChange(String(vendor.id));
              }}
              onClose={() => closePopup()}
            />
        </Drawer>
      ) : null}
      </div>
  );
};

export default VendorPicker;
