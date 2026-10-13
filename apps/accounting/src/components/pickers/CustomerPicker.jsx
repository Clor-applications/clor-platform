import { ENTITY_ICON } from '@ui/components/ui/entityIdentity';
import React from 'react';
import { Plus, Search } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { notify } from '@ui/components/ui/notify';
import PartyFormLayout from './PartyFormLayout';
import { tdsGroupSide } from '@ui/utils/tdsLedgers';
import { CUSTOMER_CFG } from './partyFormConfig';
import { AddressTab, ContactsTab, CURRENCY_OPTIONS, CUSTOMER_TABS, FormRow } from './customerFormParts';
import Modal from '@ui/components/ui/Modal';
import Drawer from '@ui/components/ui/Drawer';
import Popover from '@ui/components/ui/Popover';
import { createCustomer, listCustomers, lookupGstin, toServerCustomer, updateCustomer } from '@ui/api/masters';
import { useServerMasters, mirrorServerRows } from '@ui/hooks/useServerMasters';
import { GST_STATE_BY_CODE, getGstStateFromGstin } from '@ui/utils/gst';
import { activePriceListOptions, mergeGstinFetch, validateParty } from '@ui/utils/partyMaster';
import { getCustomerDisplayName } from '@ui/utils/contacts';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { rankedSearch, soleConfidentMatch } from '@ui/utils/rankedSearch';
import { useListboxKeys, openOnKey, focusNextAfter } from '@ui/components/pickers/useListboxKeys';
import { useRecentPicks } from '@ui/components/pickers/useRecentPicks';
import { useRemoteSearch } from '@ui/components/pickers/useRemoteSearch';
import { isValidCustomerCode, nextCustomerCode } from '@ui/utils/masterCodes';

export const CustomerForm = ({
  db,
  setDb,
  currentCompany,
  initialData = null,
  seedData = null,
  onDuplicate = null,
  /* What was typed in the field that found no match — the name is the reason
     this form was opened, so it arrives already filled in. */
  initialName = '',
  onCreated,
  onClose,
}) => {
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

  const sundryDebtorsGroup = useMemo(() => {
    return allGroups.find((g) => String(g.name || '').trim().toLowerCase() === 'sundry debtors') || null;
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
        /* The party's TDS profile, read by the one engine every screen uses.
           On the sell side it says what the customer is expected to deduct —
           the receivable itself is only recognised at receipt. */
        tdsApplicable: initialData.tdsApplicable,
        tdsNatureCode: String(initialData.tdsNatureCode || ''),
        tdsDeducteeType: String(initialData.tdsDeducteeType || 'COMPANY'),
        tdsResidentialStatus: String(initialData.tdsResidentialStatus || 'RESIDENT'),
        tdsCertificate: initialData.tdsCertificate && typeof initialData.tdsCertificate === 'object' ? initialData.tdsCertificate : null,
        tdsLedgerId: String(initialData.tdsLedgerId || ''),
        paymentTermDays:
          initialData.paymentTermDays === undefined || initialData.paymentTermDays === null
            ? ''
            : String(initialData.paymentTermDays),
        creditLimit:
          initialData.creditLimit === undefined || initialData.creditLimit === null ? '' : String(initialData.creditLimit),
        shipToAddresses: Array.isArray(initialData.shipToAddresses) ? initialData.shipToAddresses : [],
        contacts: Array.isArray(initialData.contacts) && initialData.contacts.length
          ? initialData.contacts
          : [{ name: '', position: '', email: '', mobile: '' }],
        currency: String(initialData.currency || 'INR'),
        priceListId: String(initialData.priceListId || ''),
        msmeNumber: String(initialData.msmeNumber || ''),
        statutoryOther: String(initialData.statutoryOther || ''),
        code: String(initialData.code || ''),
        notes: String(initialData.notes || ''),
        isActive: initialData.isActive !== false,
        allowCreditNotes: initialData.allowCreditNotes !== false,
        openingBalance: Number(initialData.openingBalance ?? 0),
        openingBalanceType: String(initialData.openingBalanceType || 'Dr'),
        openingBalanceBranchId: String(initialData.openingBalanceBranchId || ''),
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
     * "Duplicate this customer": everything that describes the trading
     * relationship, none of the identity. A copied GSTIN or customer code is a
     * second customer claiming to be the first one.
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
        openingBalanceType: String(seedData.openingBalanceType || 'Dr'),
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
      displayName: String(initialName || ''),
      groupId: sundryDebtorsGroup?.id ? String(sundryDebtorsGroup.id) : '',
      openingBalance: isEdit ? Number(initialData?.openingBalance ?? 0) : 0,
      openingBalanceType: isEdit ? (initialData?.openingBalanceType || 'Dr') : 'Dr',
      openingBalanceBranchId: '',
      contactPerson: '',
      mobile: '',
      email: '',
      alternatePhone: '',
      /*
       * Registered is the default because most customers a GST business bills
       * are, and because the field that follows — the GSTIN — decides how tax
       * splits on every invoice they are ever sent. Adding an unregistered
       * customer is the rarer and more deliberate act, so it is the one that
       * takes a click.
       */
      gstRegistration: 'Registered',
      gstin: '',
      pan: '',
      tdsApplicable: undefined,
      tdsNatureCode: '',
      tdsDeducteeType: 'COMPANY',
      tdsResidentialStatus: 'RESIDENT',
      tdsCertificate: null,
      tdsLedgerId: '',
      paymentTermDays: '',
      creditLimit: '',
      shipToAddresses: [],
      // One line ready to type into: the commonest customer has exactly one contact.
      contacts: [{ name: '', position: '', email: '', mobile: '' }],
      currency: 'INR',
      priceListId: '',
      msmeNumber: '',
      statutoryOther: '',
      code: '',
      notes: '',
      isActive: true,
      /* Allowed unless somebody says otherwise: refusing notes is the exception. */
      allowCreditNotes: true,
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
  if (!isEdit && !String(formData.groupId || '').trim() && sundryDebtorsGroup?.id) {
    setFormData((p) => ({ ...p, groupId: String(sundryDebtorsGroup.id) }));
  }

  const customerGroupOptions = useMemo(() => {
    const rootId = sundryDebtorsGroup?.id ? String(sundryDebtorsGroup.id) : '';
    const byId = new Map(allGroups.map((g) => [String(g.id), g]));
    const childrenByParent = new Map();
    for (const g of allGroups) {
      const pid = g?.parentGroupId !== null && g?.parentGroupId !== undefined ? String(g.parentGroupId) : '';
      if (!pid) continue;
      const arr = childrenByParent.get(pid) || [];
      arr.push(g);
      childrenByParent.set(pid, arr);
    }

    const isCustomerCat = (g) => String(g?.groupCategory || '').trim() === 'Customer';

    const ids = new Set();
    if (rootId && byId.get(rootId) && isCustomerCat(byId.get(rootId))) ids.add(rootId);

    const queue = [];
    if (rootId) queue.push(rootId);
    while (queue.length) {
      const cur = queue.shift();
      const kids = childrenByParent.get(String(cur)) || [];
      for (const k of kids) {
        if (!isCustomerCat(k)) continue;
        const kidId = String(k.id);
        if (ids.has(kidId)) continue;
        ids.add(kidId);
        queue.push(kidId);
      }
    }

    if (isEdit && String(formData.groupId || '').trim()) {
      const current = byId.get(String(formData.groupId));
      if (current && isCustomerCat(current)) ids.add(String(current.id));
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
  }, [allGroups, sundryDebtorsGroup?.id, isEdit, formData.groupId]);

  const [groupCreateOpen, setGroupCreateOpen] = useState(false);
  const [groupDraftName, setGroupDraftName] = useState('');

  const createCustomerChildGroup = (nameRaw) => {
    const name = String(nameRaw || '').trim();
    if (!name) return;
    if (!sundryDebtorsGroup?.id) {
      notify.error('Sundry Debtors group is missing.');
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
      typeId: Number(sundryDebtorsGroup.typeId),
      name,
      parentGroupId: Number(sundryDebtorsGroup.id),
      groupCategory: 'Customer',
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

  /*
   * The per-address updaters are gone. The address table edits rows through
   * `updateAddressRow`, which knows row 0 is billing, row 1 is shipping and
   * everything after is `shipToAddresses`.
   */
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


  const [tab, setTab] = useState('address');
  const saveAndNewRef = useRef(false);
  /* Reserve the previewed code for this form session. Recomputing it on every
     render made an unrelated GSTIN fetch appear to replace the customer code
     whenever the customer list refreshed in the background. */
  const [reservedCustomerCode, setReservedCustomerCode] = useState(() =>
    isEdit && isValidCustomerCode(initialData?.code)
      ? String(initialData.code).trim()
      : nextCustomerCode((db?.customers || []).filter((customer) => String(customer.id) !== String(initialData?.id || '')))
  );

  /* The lists in force today. Same rule as the vendor form, same source. */
  const priceListOptions = useMemo(
    () => activePriceListOptions({ db, companyId: currentCompany.id, onDate: new Date().toISOString().slice(0, 10) }),
    [db, currentCompany.id]
  );

  /* Shared by "Clear the form" and by Save and add another. */
  const resetForm = () =>
    setFormData((p) => ({
      ...p,
      displayName: '', gstin: '', pan: '', code: '', openingBalance: 0, openingBalanceBranchId: '',
      msmeNumber: '', statutoryOther: '', priceListId: '',
      contacts: [], shipToAddresses: [],
      billingAddress: { line1: '', line2: '', city: '', district: '', state: '', pincode: '', country: INDIA_COUNTRY },
      shippingAddress: { line1: '', line2: '', city: '', district: '', state: '', pincode: '', country: INDIA_COUNTRY },
    }));
  const [gstinFetching, setGstinFetching] = useState(false);

  /*
   * One list for the form, two stores underneath.
   *
   * Billing and shipping are columns on the party — every invoice reads them —
   * and everything past those two is a row. The form should not have to know
   * that, so the rows are assembled here in the order the master asks for and
   * taken apart again on save.
   */
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
        country: a.country || INDIA_COUNTRY,
      })),
    ],
    [formData.billingAddress, formData.shippingAddress, formData.shipToAddresses, INDIA_COUNTRY]
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
      return { ...p, shipToAddresses: p.shipToAddresses.map((a, j) => (j === idx ? { ...a, [key]: value } : a)) };
    });

  const addAddressRow = () =>
    setFormData((p) => ({
      ...p,
      shipToAddresses: [
        ...(p.shipToAddresses || []),
        {
          label: `Shipping ${(p.shipToAddresses || []).length + 2}`,
          line1: '', line2: '', city: '', district: '', state: '', pincode: '', country: INDIA_COUNTRY,
        },
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
    setFormData((p) => ({ ...p, contacts: p.contacts.map((c, j) => (j === i ? { ...c, [key]: value } : c)) }));

  const addContactRow = () =>
    setFormData((p) => ({ ...p, contacts: [...(p.contacts || []), { name: '', position: '', email: '', mobile: '' }] }));

  const removeContactRow = (i) => setFormData((p) => ({ ...p, contacts: p.contacts.filter((_, j) => j !== i) }));

  /* One primary, or none. The flag is what a reminder is addressed to. */
  const setPrimaryContact = (i) =>
    setFormData((p) => ({
      ...p,
      contacts: (p.contacts || []).map((c, j) => ({ ...c, isPrimary: j === i })),
    }));

  /*
   * What the GSTIN itself encodes is filled without asking anybody: the first
   * two digits are the state and characters 3-12 are the PAN. A configured
   * portal adds the legal name and address on top; without one the derived
   * fields still land, which is most of what the button is for.
   */
  const fetchFromGstin = async () => {
    const gstin = String(formData.gstin || '').trim().toUpperCase();
    if (gstin.length !== 15) {
      notify.error('Enter the 15-character GSTIN first.');
      return;
    }
    setGstinFetching(true);
    try {
      const data = await lookupGstin(gstin);
      /* Fills blanks, keeps what was typed — the same rule the vendor form
         follows, from the same place, so the two cannot drift apart. */
      const { next, kept } = mergeGstinFetch({ prev: formData, data: { ...data, gstin } });
      // Customer codes are allotted by this form, never by the GST registry.
      setFormData({ ...next, code: formData.code });
      notify.success(data?.source === 'derived' ? 'State and PAN filled from the GSTIN.' : 'Fetched from the GST portal.');
      if (kept.length) {
        notify.info(`Kept what you had typed for the ${kept.join(', ')}. Clear a field and fetch again to take the portal's version.`);
      }
    } catch (e) {
      notify.error(String(e?.message || 'Could not fetch that GSTIN.'));
    } finally {
      setGstinFetching(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    /*
     * Which button was pressed. "Save and New" clears the form and keeps it
     * open, which is what somebody entering a list wants; Save closes. Read
     * from the submitter rather than held in state, so the two buttons cannot
     * disagree with what actually happened.
     */
    const saveAndNew = saveAndNewRef.current;
    saveAndNewRef.current = false;

    const selectedGroupIdRaw = String(formData.groupId || '').trim();
    const effectiveGroupId = selectedGroupIdRaw
      ? Number(selectedGroupIdRaw)
      : sundryDebtorsGroup
        ? Number(sundryDebtorsGroup.id)
        : null;

    const complaint = validateParty({
      values: { ...formData, groupId: selectedGroupIdRaw || (sundryDebtorsGroup ? String(sundryDebtorsGroup.id) : '') },
      noun: 'Customer',
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
    const shippingCountry = String(formData.shippingAddress?.country || '').trim();
    const billingState = String(formData.billingAddress?.state || '').trim();
    const shippingState = String(formData.shippingAddress?.state || '').trim();

    if (billingCountry === INDIA_COUNTRY && !billingState) {
      notify.error('Billing state is required for India.');
      return;
    }

    if (!formData.shippingSameAsBilling && shippingCountry === INDIA_COUNTRY && !shippingState) {
      notify.error('Shipping state is required for India.');
      return;
    }

    if (gstRegistrationRequiresGstin) {
      const stateFromGstin = getGstinState(effectiveGstin);
      if (!stateFromGstin) {
        notify.error('Unable to derive State from GSTIN. Please check GSTIN.');
        return;
      }
      if (billingCountry === INDIA_COUNTRY && billingState && String(stateFromGstin).trim().toLowerCase() !== String(billingState).trim().toLowerCase()) {
        notify.error('Billing State does not match GSTIN State.');
        return;
      }
    }

    const billingStateFinal = String(gstStateAuto || formData.billingAddress.state || '').trim();
    const shippingStateFinal = String(formData.shippingSameAsBilling ? billingStateFinal : formData.shippingAddress.state || '').trim();

    const allottedCustomerCode = isEdit && isValidCustomerCode(formData.code)
      ? String(formData.code).trim()
      : reservedCustomerCode;
    const payloadBase = {
      companyId: currentCompany.id,
      ...formData,
      // Keep the browser copy and the server record on the same six-digit
      // customer series, including when the connection is temporarily down.
      code: allottedCustomerCode,
      name: formData.displayName.trim(),
      gstin: effectiveGstin,
      pan: effectivePan,
      // Stored as a number so the due-date maths never sees "30" as a string.
      // Blank stays undefined, which the due-date helper reads as the default.
      paymentTermDays:
        String(formData.paymentTermDays ?? '').trim() === ''
          ? undefined
          : Math.min(365, Math.max(0, Math.trunc(Number(formData.paymentTermDays) || 0))),
      creditLimit:
        String(formData.creditLimit ?? '').trim() === '' ? undefined : Math.max(0, Number(formData.creditLimit) || 0),
      shipToAddresses: (formData.shipToAddresses || []).filter((a) => String(a.line1 || a.label || '').trim()),
      // A contact row with no name is an empty row somebody added and left.
      contacts: (formData.contacts || []).filter((c) => String(c.name || '').trim()),
      billingAddress: {
        ...formData.billingAddress,
        state: billingStateFinal,
        country: billingCountry || INDIA_COUNTRY,
      },
      shippingAddress: formData.shippingSameAsBilling
        ? {
            ...formData.billingAddress,
            state: billingStateFinal,
            country: billingCountry || INDIA_COUNTRY,
          }
        : {
            ...formData.shippingAddress,
            state: shippingStateFinal,
            country: shippingCountry || INDIA_COUNTRY,
          },
    };

    if (isEdit) {
      const existing = (db.customers || []).find(
        (c) => c.companyId === currentCompany.id && String(c.id) === String(initialData?.id)
      );
      if (!existing) {
        notify.error('Customer not found. It may have been removed.');
        onClose?.();
        return;
      }

      const updatedCustomer = {
        ...existing,
        ...payloadBase,
        balance: existing.balance || 0,
        groupId: effectiveGroupId,
      };

      const coa = Array.isArray(db.chartOfAccounts) ? db.chartOfAccounts : [];
      const groups = Array.isArray(db.accountGroups) ? db.accountGroups : [];
      const groupRow = effectiveGroupId ? groups.find((g) => Number(g.id) === Number(effectiveGroupId) && g.companyId === currentCompany.id) : null;
      const typeRow = groupRow ? accountTypeById.get(String(groupRow.typeId)) : null;

      const existingLedger = updatedCustomer?.accountId
        ? coa.find((a) => a.companyId === currentCompany.id && String(a.id) === String(updatedCustomer.accountId))
        : null;

      const nextCoaId = coa.reduce((m, a) => Math.max(m, Number(a?.id || 0)), 0) + 1;

      const ledgerName = getCustomerDisplayName(updatedCustomer);
      const ledgerCode = updatedCustomer.code || existingLedger?.code || '';

      const upsertLedger = existingLedger
        ? {
            ...existingLedger,
            code: ledgerCode,
            name: ledgerName,
            ledgerCategory: 'Customer',
            groupId: effectiveGroupId,
            type: String(typeRow?.accountClass || existingLedger.type || 'Asset'),
            subType: String(typeRow?.name || existingLedger.subType || ''),
            main: String(typeRow?.main || existingLedger.main || 'Balance Sheet'),
            openingBalance: Math.round((Number(formData.openingBalance) || 0) * 100) / 100,
            openingBalanceType: formData.openingBalanceType || 'Dr',
            openingBalanceBranchId: String(formData.openingBalanceBranchId || ''),
            updatedAt: new Date().toISOString(),
          }
        : {
            id: nextCoaId,
            companyId: currentCompany.id,
            code: ledgerCode,
            name: ledgerName,
            ledgerCategory: 'Customer',
            groupId: effectiveGroupId,
            type: String(typeRow?.accountClass || 'Asset'),
            subType: String(typeRow?.name || ''),
            main: String(typeRow?.main || 'Balance Sheet'),
            balance: 0,
            openingBalance: Math.round((Number(formData.openingBalance) || 0) * 100) / 100,
            openingBalanceType: formData.openingBalanceType || 'Dr',
            openingBalanceBranchId: String(formData.openingBalanceBranchId || ''),
            createdAt: new Date().toISOString(),
          };

      const nextChartOfAccounts = existingLedger
        ? coa.map((a) => (a.companyId === currentCompany.id && String(a.id) === String(existingLedger.id) ? upsertLedger : a))
        : [...coa, upsertLedger];

      const finalCustomer = {
        ...updatedCustomer,
        accountId: existingLedger ? existingLedger.id : upsertLedger.id,
      };

      if (existing.backendPartyId) {
        try {
          await updateCustomer(existing.backendPartyId, toServerCustomer(finalCustomer));
        } catch (e) {
          notify.error(`Updated on this device only — the server refused it: ${String(e?.message || e)}`);
        }
      }

      setDb({
        ...db,
        chartOfAccounts: nextChartOfAccounts,
        customers: (db.customers || []).map((c) =>
          c.companyId === currentCompany.id && String(c.id) === String(existing.id) ? finalCustomer : c
        ),
      });

      if (typeof onCreated === 'function') onCreated(finalCustomer);
      if (typeof onClose === 'function') {
        onClose();
        return;
      }

      notify.success('Customer updated!');
      return;
    }

    const nextId = Math.max(0, ...(Array.isArray(db.customers) ? db.customers : []).map((c) => Number(c.id) || 0)) + 1;
    const newCustomer = {
      id: nextId,
      ...payloadBase,
      balance: 0,
      groupId: effectiveGroupId,
    };

    const coa = Array.isArray(db.chartOfAccounts) ? db.chartOfAccounts : [];
    const groups = Array.isArray(db.accountGroups) ? db.accountGroups : [];
    const groupRow = effectiveGroupId ? groups.find((g) => Number(g.id) === Number(effectiveGroupId) && g.companyId === currentCompany.id) : null;
    const typeRow = groupRow ? accountTypeById.get(String(groupRow.typeId)) : null;

    const nextCoaId = coa.reduce((m, a) => Math.max(m, Number(a?.id || 0)), 0) + 1;
    const ledger = {
      id: nextCoaId,
      companyId: currentCompany.id,
      code: newCustomer.code,
      name: getCustomerDisplayName(newCustomer),
      ledgerCategory: 'Customer',
      groupId: effectiveGroupId,
      type: String(typeRow?.accountClass || 'Asset'),
      subType: String(typeRow?.name || ''),
      main: String(typeRow?.main || 'Balance Sheet'),
      balance: 0,
      openingBalance: Math.round((Number(formData.openingBalance) || 0) * 100) / 100,
      openingBalanceType: formData.openingBalanceType || 'Dr',
      openingBalanceBranchId: String(formData.openingBalanceBranchId || ''),
      createdAt: new Date().toISOString(),
    };

    const finalCustomer = { ...newCustomer, accountId: ledger.id };

    /*
     * Write through to the server, then keep what it allotted.
     *
     * This used to happen only when a customer was created from inside an
     * invoice, and even there it sent six fields. Created from the Customers
     * screen it never happened at all: the record lived in one browser, the
     * contacts and extra addresses reached nothing, and the customer code the
     * server allots — the "auto generated" the master asks for — was never
     * asked for, so it stayed blank.
     *
     * Failure is not fatal. A customer entered offline stays local and usable;
     * losing the whole entry because the network went would be the worse
     * trade.
     */
    let serverPatch = {};
    try {
      const created = await createCustomer(toServerCustomer(finalCustomer));
      const party = created?.party;
      if (party?.id) serverPatch = { backendPartyId: String(party.id), code: party.code || finalCustomer.code || '' };
    } catch (e) {
      notify.error(`Saved on this device only — the server refused it: ${String(e?.message || e)}`);
    }

    const storedCustomer = { ...finalCustomer, ...serverPatch };
    setDb({ ...db, chartOfAccounts: [...coa, ledger], customers: [...(db.customers || []), storedCustomer] });

    if (typeof onCreated === 'function') onCreated(storedCustomer);
    if (saveAndNew) {
      setReservedCustomerCode(nextCustomerCode([...(db.customers || []), storedCustomer]));
      setFormData((p) => ({
        ...p,
        displayName: '', gstin: '', pan: '', code: '', openingBalance: 0, openingBalanceBranchId: '',
        contacts: [{ name: '', position: '', email: '', mobile: '' }], shipToAddresses: [],
        billingAddress: { line1: '', line2: '', city: '', district: '', state: '', pincode: '', country: INDIA_COUNTRY },
        shippingAddress: { line1: '', line2: '', city: '', district: '', state: '', pincode: '', country: INDIA_COUNTRY },
      }));
      setTab('address');
      notify.success('Customer created. Ready for the next one.');
      return;
    }
    if (typeof onClose === 'function') {
      onClose();
      return;
    }

    notify.success('Customer created!');
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="customer-create-form flex min-h-0 flex-col">
        {/*
          The same header the invoice uses, not a second one that looks like
          it. Title on the left, every way out of the screen on the right —
          Back, Cancel, Save, and a three-dot menu for the rest. Sticky, so Save
          is reachable from the bottom of a long address table.

          At the top rather than the bottom because a form with tabs has no
          single bottom: the page ends wherever the open tab ends, so a bar down
          there moved as you switched between Address and Others.
        */}
        <PartyFormLayout
          cfg={CUSTOMER_CFG}
          formData={formData}
          setFormData={setFormData}
          isEdit={isEdit}
          subtitle={isEdit ? getCustomerDisplayName(initialData) || '' : ''}
          onClose={onClose}
          resetForm={resetForm}
          saveAndNewRef={saveAndNewRef}
          tab={tab}
          setTab={setTab}
          tabs={CUSTOMER_TABS}
          tdsLedgerOptions={(db?.chartOfAccounts || [])
            .filter((a) => a.companyId === currentCompany?.id && a.isActive !== false)
            .filter(
              (a) =>
                (String(a.tdsSide || '').toUpperCase() ||
                  tdsGroupSide((db?.accountGroups || []).filter((g) => g.companyId === currentCompany?.id), a.groupId)) === 'RECEIVABLE'
            )
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))}
          groupOptions={customerGroupOptions}
          onCreateGroup={(typed) => {
            setGroupDraftName(typed);
            setGroupCreateOpen(true);
          }}
          codesEnabled={true}
          automaticCode={reservedCustomerCode}
          priceListOptions={priceListOptions}
          branchOptions={branchOptions}
          multiBranchEnabled={multiBranchEnabled}
          baseCurrency={currentCompany?.currency || currentCompany?.baseCurrency || 'INR'}
          onDuplicate={isEdit && onDuplicate ? () => onDuplicate(formData) : null}
          gstinFetching={gstinFetching}
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
              createCustomerChildGroup(groupDraftName);
            }}
            className="space-y-4"
          >
            <div>
              <label className="ui-label" htmlFor="customerpicker-group-name">Group Name</label>
              <input id="customerpicker-group-name"
                type="text"
                value={groupDraftName}
                onChange={(e) => setGroupDraftName(e.target.value)}
                className="ui-input w-full"
                placeholder="e.g., Walk-in Customers"
                autoFocus
                required
              />
              <div className="text-xs ui-muted mt-1">This group will be created under Sundry Debtors.</div>
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

const CustomerPicker = ({ db, setDb, currentCompany, value, onChange, label = 'Customer', disabled = false, disabledHint = '', icon: LeadingIcon = ENTITY_ICON.customer }) => {
  // Customers live on the server now. The local list stays as a fallback so a
  // network failure does not empty the picker in the middle of an invoice.
  const serverCustomers = useServerMasters(
    useCallback((search) => listCustomers(search).then((d) => d?.customers || []), []),
    (db?.customers || []).filter((c) => Number(c.companyId) === Number(currentCompany?.id))
  );

  // Server rows mirror into the local collection; the picker lists ONLY local
  // rows so every selection is a local numeric id (backendPartyId rides
  // along). This is what makes Number(partyId) checks downstream valid again.
  useEffect(() => {
    if (serverCustomers.source !== 'server' || typeof setDb !== 'function') return;
    mirrorServerRows({
      setDb,
      collection: 'customers',
      backendKey: 'backendPartyId',
      serverRows: serverCustomers.rows,
      companyId: currentCompany?.id,
      mapRow: (srv) => {
        const addresses = Array.isArray(srv.addresses) ? srv.addresses : [];
        const billing = addresses.find((address) => String(address.key || '').toUpperCase() === 'BILLING') || {};
        const shipping = addresses.find((address) => String(address.key || '').toUpperCase() === 'SHIPPING') || {};
        const addressValue = (address, prefix) => ({
          line1: address.line1 ?? srv[`${prefix}Line1`] ?? '',
          line2: address.line2 ?? srv[`${prefix}Line2`] ?? '',
          city: address.city ?? srv[`${prefix}City`] ?? '',
          district: address.district ?? srv[`${prefix}District`] ?? '',
          state: address.state ?? srv[`${prefix}State`] ?? '',
          pincode: address.pincode ?? srv[`${prefix}Pincode`] ?? '',
          country: address.country ?? srv[`${prefix}Country`] ?? 'India',
        });
        return {
          name: srv.name || '', displayName: srv.name || '', code: srv.code || '',
          contactPerson: srv.contactPerson || '',
          gstin: srv.gstin || '', pan: srv.pan || '',
          gstRegistration: srv.gstRegistration || (srv.gstRegistrationType === 'REGULAR' ? 'Registered' : srv.gstRegistrationType === 'COMPOSITION' ? 'Composition' : 'Unregistered'),
          state: srv.state || srv.billingState || billing.state || '',
          email: srv.email || '', mobile: srv.phone || srv.mobile || '',
          paymentTermDays: srv.paymentTermDays ?? null,
          paymentTermName: srv.paymentTermName || '', creditLimit: srv.creditLimit ?? null,
          openingBalance: Number(srv.openingBalance || 0), openingBalanceType: srv.openingBalanceType || 'Dr',
          currency: srv.currency || 'INR', priceListId: srv.priceListId || '',
          groupName: srv.partyGroup || '', notes: srv.notes || '',
          msmeNumber: srv.msmeNumber || '', statutoryOther: srv.statutoryOther || '',
          isActive: srv.isActive !== false, shippingSameAsBilling: srv.shippingSameAsBilling !== false,
          billingAddress: addressValue(billing, 'billing'),
          shippingAddress: addressValue(shipping, 'shipping'),
          shipToAddresses: addresses.filter((address) => !['BILLING', 'SHIPPING'].includes(String(address.key || '').toUpperCase())),
          contacts: Array.isArray(srv.contacts) ? srv.contacts : [],
          tdsApplicable: srv.tdsApplicable, tdsNatureCode: srv.tdsNatureCode || '',
          tdsDeducteeType: srv.tdsDeducteeType || '', tdsResidentialStatus: srv.tdsResidentialStatus || '',
          tdsLedgerId: srv.tdsLedgerId || '', tdsCertificate: srv.tdsCertificate || null,
          createdAt: srv.createdAt || new Date().toISOString(),
        };
      },
    });
  }, [serverCustomers.source, serverCustomers.rows, setDb, currentCompany?.id]);

  const allCustomers = (db?.customers || []).filter((c) => Number(c.companyId) === Number(currentCompany?.id));
  const customers = allCustomers.filter((customer) => customer.isActive !== false);

  // Server ids are strings; documents written before the migration hold numbers.
  const findCustomer = (id) =>
    allCustomers.find((c) => String(c.id) === String(id)) ||
    (db?.customers || []).find((c) => String(c.id) === String(id));
  const triggerRef = useRef(null);
  const [showCustomerPopup, setShowCustomerPopup] = useState(false);
  const [customerPopupMode, setCustomerPopupMode] = useState('select');
  const [customerSearch, setCustomerSearch] = useState('');

  const selectedCustomerName = value ? getCustomerDisplayName(findCustomer(value)) : '';

  const normalizedCustomerSearch = customerSearch.trim().toLowerCase();
  const recents = useRecentPicks('customer', currentCompany?.id);

  // Above the page the server returns, typing has to reach the server or the
  // name may simply not be in the browser to find.
  useRemoteSearch(serverCustomers.reload, customerSearch, {
    localSize: customers.length,
    enabled: showCustomerPopup,
  });

  /*
   * Ranked, not merely filtered.
   *
   * A substring match put "Sundaram Traders" above "Ram Kumar" for the query
   * "ram", because that was the order the array happened to be in. The shared
   * ranking puts an exact hit first, then a name that starts with what was
   * typed, then a word inside it, then a GSTIN or phone, then a loose
   * subsequence.
   *
   * With nothing typed the list leads with whoever this operator actually
   * invoices, which for most shops is the same fifteen names all week.
   */
  const filteredCustomers = normalizedCustomerSearch
    ? rankedSearch(customers, normalizedCustomerSearch, {
        fields: (c) => [
          getCustomerDisplayName(c),
          c.contactPerson,
          c.email,
          c.mobile || c.phone,
        ],
        codes: (c) => [c.gstin, c.pan, c.mobile || c.phone],
      })
    : recents.promote(customers);

  /*
   * Closing puts focus back on the field that opened it.
   *
   * Without this the dialog unmounts and focus falls to the document body, so
   * the Tab after a selection starts again from the top of the page instead
   * of moving to the next field — which breaks the whole point of picking
   * without the mouse.
   */
  const closePopup = ({ advance = false, refocus = true } = {}) => {
    setShowCustomerPopup(false);
    setCustomerPopupMode('select');
    setCustomerSearch('');
    /*
     * `refocus: false` for a dismissal that came from OUTSIDE the field.
     *
     * Clicking another control used to close the list and then pull the caret
     * back to this field — which, when the field opens on focus, reopened the
     * list over whatever had just been clicked. The field appeared stuck and
     * nothing else on the form could be reached.
     */
    if (!refocus) return;
    requestAnimationFrame(() => {
      // Choosing moves on; cancelling stays put. See focusNextAfter.
      if (advance) focusNextAfter(triggerRef.current);
      else triggerRef.current?.focus({ preventScroll: true });
    });
  };

  const chooseCustomer = (customer) => {
    if (!customer) return;
    if (customer.isActive === false) {
      notify.error('This customer is inactive. Activate the customer before creating a new entry.');
      return;
    }
    recents.remember(customer.id);
    onChange(String(customer.id));
    closePopup({ advance: true });
  };

  const openPopup = () => {
    if (disabled) return;
    setCustomerPopupMode('select');
    setCustomerSearch('');
    setShowCustomerPopup(true);
  };

  const customerSearchOpts = {
    fields: (c) => [getCustomerDisplayName(c), c.contactPerson, c.email, c.mobile || c.phone],
    codes: (c) => [c.gstin, c.pan, c.mobile || c.phone],
  };

  /*
   * Tab out of the search box takes the one match, when there is exactly one.
   *
   * Requirement 15 says highlight without auto-selecting while somebody is
   * still typing; section 9 says a full code should not have to be confirmed.
   * Both hold at once if the selection happens on the way out of the field
   * rather than on every keystroke.
   */
  const onCustomerSearchTab = (e) => {
    if (e.key !== 'Tab' || e.shiftKey) return;
    const sole = soleConfidentMatch(customers, customerSearch, customerSearchOpts);
    if (!sole) return;
    // Swallow the Tab: the dialog's focus trap would otherwise move focus
    // inside a dialog that is closing on this very keystroke.
    e.preventDefault();
    e.stopPropagation();
    chooseCustomer(sole);
  };

  const customerRecentCount = normalizedCustomerSearch ? 0 : recents.recentCount(filteredCustomers);

  const {
    activeIndex: customerActiveIndex,
    setActiveIndex: setCustomerActiveIndex,
    listRef: customerListRef,
    onKeyDown: onCustomerListKeys,
  } = useListboxKeys({
    count: filteredCustomers.length,
    onChoose: (i) => chooseCustomer(filteredCustomers[i]),
    onCancel: () => closePopup(),
    // Tab off a list nobody drove: leave the value alone and carry on,
    // rather than snapping back to the field just left.
    onTabOut: () => closePopup({ advance: true }),
  });

  return (
    /*
      One element, not a fragment.
      Returned as `<><label/><button/></>` the two halves became two cells of
      whatever grid the picker was dropped into — the label in one column and
      the control in the next, which is what the recurring form was showing.
    */
    <div className="min-w-0">
      <label className="ui-label">{label}</label>
      {/*
        A field somebody types a name into, not a button that opens a list.

        The old trigger said "Select Customer" and did nothing until it was
        clicked; the name was already in the operator's head and in their
        hands, and it had nowhere to go. Typing here narrows the list as the
        letters arrive, and a name that matches nothing offers to create it —
        which is the other half of the same motion.
      */}
      <div className="relative">
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
          value={showCustomerPopup ? customerSearch : selectedCustomerName}
          placeholder="Type a customer name"
          onMouseDown={() => {
            /*
             * Opened by a click or by typing — never by focus alone.
             *
             * Focus arrives for reasons that are not a request to choose: the
             * caret handed back as the list closes, a form restoring focus,
             * Tab passing through. Opening on any of those put the list back
             * on screen the instant it was dismissed, over whatever had just
             * been clicked.
             */
            if (disabled || showCustomerPopup) return;
            setCustomerPopupMode('select');
            setCustomerSearch('');
            setShowCustomerPopup(true);
          }}
          onChange={(e) => {
            if (disabled) return;
            if (!showCustomerPopup) {
              setCustomerPopupMode('select');
              setShowCustomerPopup(true);
            }
            setCustomerSearch(e.target.value);
            setCustomerActiveIndex(0);
          }}
          onKeyDown={(e) => {
            if (disabled) return;
            if (!showCustomerPopup) {
              openOnKey(openPopup)(e);
              return;
            }
            /* Tab commits a name that can only mean one customer — section 9's
               "a full code should not have to be confirmed" — and otherwise
               leaves the field alone. */
            onCustomerSearchTab(e);
            onCustomerListKeys(e);
          }}
          aria-haspopup="listbox"
          aria-expanded={showCustomerPopup}
          aria-autocomplete="list"
          aria-controls={showCustomerPopup ? 'customer-picker-list' : undefined}
          className={`ui-input w-full${LeadingIcon ? ' ps-9' : ''}${disabled ? ' opacity-60 cursor-not-allowed' : ''}`}
        />
      </div>
      {disabled && disabledHint ? <div className="text-xs ui-muted mt-1">{disabledHint}</div> : null}

      {/*
        The suggestions hang off the field rather than dimming the page.

        A dialog was the right price for the creation form and far too high for
        picking a name somebody is already typing: it hid the document behind
        it, and it put a second search box on screen underneath the one the
        caret was in.
      */}
      {showCustomerPopup && customerPopupMode === 'select' ? (
        <Popover
          anchorRef={triggerRef}
          onClose={() => closePopup({ refocus: false })}
          autoFocus={false}
          minWidth={320}
        >
          <div
            id="customer-picker-list"
            ref={customerListRef}
            role="listbox"
            className="max-h-80 overflow-y-auto p-1"
          >
            {filteredCustomers.length === 0 ? (
              <div className="px-3 py-4 text-sm ui-muted">
                {normalizedCustomerSearch ? `No customer matches “${customerSearch.trim()}”.` : 'No customers yet.'}
              </div>
            ) : (
              filteredCustomers.map((c, i) => {
                const on = i === customerActiveIndex;
                return (
                  <React.Fragment key={c.id}>
                    {/* The habitual names, called what they are. */}
                    {customerRecentCount && i === 0 ? (
                      <div className="ui-caption px-2 pt-1 pb-0.5">Recently used</div>
                    ) : null}
                    {customerRecentCount && i === customerRecentCount ? (
                      <div className="ui-caption px-2 pt-2 pb-0.5">All customers</div>
                    ) : null}
                    <button
                      id={`customer-opt-${c.id}`}
                      type="button"
                      role="option"
                      aria-selected={String(c.id) === String(value)}
                      data-active={on || undefined}
                      onMouseEnter={() => setCustomerActiveIndex(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => chooseCustomer(c)}
                      className={`w-full rounded-lg px-3 py-2 text-left ${on ? '' : 'ui-hover-sunken'}`}
                      style={
                        on
                          ? {
                              backgroundColor: 'rgb(var(--brand))',
                              color: 'rgb(var(--on-brand))',
                            }
                          : undefined
                      }
                    >
                      <div className={`text-sm font-medium ${on ? '' : 'ui-fg'}`}>{getCustomerDisplayName(c)}</div>
                      {(c.email || c.mobile || c.phone) && (
                        <div className={`text-xs truncate ${on ? 'opacity-80' : 'ui-muted'}`}>
                          {[c.email, c.mobile || c.phone].filter(Boolean).join(' • ')}
                        </div>
                      )}
                    </button>
                  </React.Fragment>
                );
              })
            )}
          </div>

          {/* Creating is the other half of the same motion, so it sits at the
              foot of the list rather than behind a separate button — and it
              carries whatever was typed into the new customer's name. */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setCustomerPopupMode('create')}
            className="ui-hover-sunken flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm"
          >
            <Plus size={14} aria-hidden="true" />
            {normalizedCustomerSearch
              ? `Create “${customerSearch.trim()}”`
              : 'Create a new customer'}
          </button>
        </Popover>
      ) : null}

      {showCustomerPopup && customerPopupMode === 'create' ? (
        <Drawer open onClose={() => closePopup()} title="Create Customer" widthClass="ui-form-drawer">
          <CustomerForm
            db={db}
            setDb={setDb}
            currentCompany={currentCompany}
            /* What was typed is the name they meant. */
            initialName={customerSearch.trim()}
            onCreated={async (customer) => {
              /*
               * The form has already written the customer to the server and
               * carries the id it came back with. Selecting that server id
               * directly would break every screen that resolves the selection
               * with Number(customerId) against db.customers — a cuid is NaN
               * there — so the local numeric id stays the selection and
               * backendPartyId rides alongside for the API.
               */
              if (customer?.backendPartyId) {
                await serverCustomers.reload();
              }
              onChange(String(customer.id));
            }}
            onClose={() => closePopup()}
          />
        </Drawer>
      ) : null}
    </div>
  );
};

export default CustomerPicker;
