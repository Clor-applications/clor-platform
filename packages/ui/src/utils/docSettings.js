export const VOUCHER_DEFS = [
  { key: 'invoice', label: 'Invoice', listKey: 'invoices' },
  { key: 'estimate', label: 'Estimate', listKey: 'estimates' },
  { key: 'bill', label: 'Purchase (Bill)', listKey: 'bills' },
  { key: 'purchaseOrder', label: 'Purchase Order', listKey: 'purchaseOrders' },
  { key: 'debitNote', label: 'Debit Note', listKey: 'debitNotes' },
  { key: 'expense', label: 'Expense', listKey: 'expenses' },
  { key: 'creditNote', label: 'Credit Note', listKey: 'creditNotes' },
  { key: 'journalEntry', label: 'Journal Entry', listKey: 'journalEntries' },
];

// Numbering supports additional voucher types beyond printable templates.
export const NUMBERING_VOUCHER_DEFS = [
  ...VOUCHER_DEFS,
  { key: 'warehouseTransfer', label: 'Warehouse Transfer', listKey: null },
  { key: 'branchTransfer', label: 'Branch Transfer', listKey: null },
  // Every document a branch raises gets its own series, so two branches
  // never collide on a number and each book reads as its own.
  { key: 'salesOrder', label: 'Sales Order', listKey: 'salesOrders' },
  { key: 'pos', label: 'POS Sale', listKey: null },
  { key: 'deliveryChallan', label: 'Delivery Challan', listKey: 'deliveryChallans' },
  { key: 'receipt', label: 'Receipt', listKey: null },
  { key: 'payment', label: 'Payment', listKey: null },
  { key: 'stockAdjustment', label: 'Stock Adjustment', listKey: 'stockAdjustments' },
];

export const TEMPLATE_OPTIONS = [
  { id: 'classic', name: 'Classic' },
  { id: 'modern', name: 'Modern' },
  { id: 'minimal', name: 'Minimal' },
  { id: 'compact', name: 'Compact' },
  { id: 'bold', name: 'Bold' },
  { id: 'a5', name: 'A5 (GST)' },
  { id: 'a5Compact', name: 'A5 (Compact)' },
  { id: 'a5Clean', name: 'A5 (Clean)' },
  { id: 'a5Boxed', name: 'A5 (Boxed)' },
  { id: 'a4Modern', name: 'A4 (Modern)' },
  { id: 'a4BoxedGst', name: 'A4 (Boxed GST Split)' },
  { id: 'a4Letterhead', name: 'A4 (Letterhead)' },
];

export const ACCENT_OPTIONS = [
  { id: 'blue', name: 'Blue', barClass: 'bg-blue-600' },
  { id: 'indigo', name: 'Indigo', barClass: 'bg-indigo-600' },
  { id: 'green', name: 'Green', barClass: 'bg-green-600' },
  { id: 'orange', name: 'Orange', barClass: 'bg-orange-600' },
  { id: 'violet', name: 'Violet', barClass: 'bg-violet-600' },
  { id: 'slate', name: 'Slate', barClass: 'bg-slate-600' },
];

export const getVoucherDef = (voucherKey) => VOUCHER_DEFS.find((v) => v.key === voucherKey);

export const getNumberingVoucherDef = (voucherKey) => NUMBERING_VOUCHER_DEFS.find((v) => v.key === voucherKey);

export const getDocSettings = (db, company, { branchId = null } = {}) => {
  const companyId = company?.id;
  const base = company?.docSettings || {};

  const normalizedBranchId = branchId ? String(branchId).trim() : '';
  const byBranch = (base?.numberingByBranch && typeof base.numberingByBranch === 'object') ? base.numberingByBranch : {};
  const branchOverrides = normalizedBranchId ? (byBranch?.[normalizedBranchId] || {}) : {};

  const ensureNumbering = (voucherKey, fallbackPrefix, { fallbackNextNumber } = {}) => {
    const listKey = getNumberingVoucherDef(voucherKey)?.listKey;
    const count = listKey ? (db?.[listKey] || []).filter((d) => d.companyId === companyId).length : 0;
    const existing = (branchOverrides && typeof branchOverrides === 'object' && branchOverrides?.[voucherKey])
      ? branchOverrides[voucherKey]
      : (base?.numbering?.[voucherKey] || {});
    return {
      mode: existing.mode || 'auto',
      enabled: existing.enabled !== false,
      prefix: existing.prefix !== undefined ? existing.prefix : fallbackPrefix,
      suffix: existing.suffix !== undefined ? existing.suffix : '',
      nextNumber:
        Number(existing.nextNumber || 0) > 0
          ? Number(existing.nextNumber)
          : (Number(fallbackNextNumber || 0) > 0 ? Number(fallbackNextNumber) : count + 1),
      allowManualOverride: existing.allowManualOverride !== undefined ? Boolean(existing.allowManualOverride) : true,
      dateFormat: existing.dateFormat || 'none',
      separator: existing.separator !== undefined ? existing.separator : '-',
      resetFrequency: existing.resetFrequency || 'never',
      includeBranchCode: Boolean(existing.includeBranchCode),
      includeLocationCode: Boolean(existing.includeLocationCode),
      includeDocumentTypeCode: Boolean(existing.includeDocumentTypeCode),
      branchCode: String(existing.branchCode || ''),
      locationCode: String(existing.locationCode || ''),
      documentTypeCode: String(existing.documentTypeCode || ''),
      /**
       * How wide the counter is written: 4 turns 1 into 0001.
       *
       * Zero means no padding, and it is the default on purpose. A book that
       * has already issued INV-1 and INV-2 must not have its next document
       * come out as INV-0003 — the run would read as two different series.
       * Widening is a choice somebody makes, usually before the first
       * document, not something applied to their existing numbers.
       */
      digits: clampDigits(existing.digits),
    };
  };

  const ensureTemplate = (voucherKey, templateId, accentId) => {
    const existing = base?.templates?.[voucherKey] || {};
    return {
      // Preserve everything stored (termsText and future options) — only the
      // two defaults are normalized.
      ...existing,
      templateId: existing.templateId || templateId,
      accentId: existing.accentId || accentId,
    };
  };

  return {
    ...base,
    numbering: {
      invoice: ensureNumbering('invoice', 'INV-'),
      estimate: ensureNumbering('estimate', 'EST-'),
      bill: ensureNumbering('bill', 'BILL-'),
      purchaseOrder: ensureNumbering('purchaseOrder', 'PO-'),
      expense: ensureNumbering('expense', 'EXP-'),
      creditNote: ensureNumbering('creditNote', 'CN-'),
      debitNote: ensureNumbering('debitNote', 'DN-'),
      journalEntry: ensureNumbering('journalEntry', 'JE-'),
      warehouseTransfer: ensureNumbering('warehouseTransfer', 'WT-', { fallbackNextNumber: 1 }),
      branchTransfer: ensureNumbering('branchTransfer', 'BT-', { fallbackNextNumber: 1 }),
      salesOrder: ensureNumbering('salesOrder', 'SO-', { fallbackNextNumber: 1 }),
      pos: ensureNumbering('pos', 'POS-', { fallbackNextNumber: 1 }),
      deliveryChallan: ensureNumbering('deliveryChallan', 'DC-', { fallbackNextNumber: 1 }),
      receipt: ensureNumbering('receipt', 'RCPT-', { fallbackNextNumber: 1 }),
      payment: ensureNumbering('payment', 'PAY-', { fallbackNextNumber: 1 }),
      stockAdjustment: ensureNumbering('stockAdjustment', 'ADJ-', { fallbackNextNumber: 1 }),
    },
    templates: {
      invoice: ensureTemplate('invoice', 'classic', 'blue'),
      estimate: ensureTemplate('estimate', 'classic', 'blue'),
      bill: ensureTemplate('bill', 'classic', 'indigo'),
      purchaseOrder: ensureTemplate('purchaseOrder', 'classic', 'indigo'),
      expense: ensureTemplate('expense', 'minimal', 'slate'),
      creditNote: ensureTemplate('creditNote', 'classic', 'orange'),
      debitNote: ensureTemplate('debitNote', 'classic', 'orange'),
      journalEntry: ensureTemplate('journalEntry', 'minimal', 'slate'),
    },
  };
};

/** 0 = write the counter as-is; 1..10 = pad it to that many digits. */
export const clampDigits = (value) => {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(10, n);
};

export const formatVoucherNumberPreview = (numbering, offset = 0) => {
  if (!numbering) return '';
  if (numbering.enabled === false) return '(automatic numbering off)';
  if (String(numbering.mode || '').toLowerCase() === 'manual') return '(manual)';
  const prefix = String(numbering.prefix || '');
  const suffix = String(numbering.suffix || '');
  const raw = Number(numbering.nextNumber || 1) + (Number(offset) || 0);
  const n = Number.isFinite(raw) ? raw : 1;
  const digits = clampDigits(numbering.digits);
  // A counter that has outgrown its width keeps every digit. Trimming 10000
  // down to 0000 to fit would hand two documents the same number.
  const body = digits ? String(n).padStart(digits, '0') : String(n);
  const dateFormat = String(numbering.dateFormat || 'none').toLowerCase();
  const usesSegments = dateFormat !== 'none' || numbering.includeBranchCode || numbering.includeLocationCode || numbering.includeDocumentTypeCode;
  if (!usesSegments) return `${prefix}${body}${suffix}`;
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const yy = yyyy.slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const datePart = ({ yyyy, yy, 'yyyy-mm': `${yyyy}-${mm}`, 'yy-mm': `${yy}-${mm}`, 'fy': `${yyyy}-${String(now.getFullYear() + 1).slice(-2)}` })[dateFormat] || '';
  const separator = String(numbering.separator ?? '-');
  // Prefixes from older books commonly end in "-". Strip only known
  // separator punctuation at segment edges so switching to "/", ".", or no
  // separator never leaves a mixed "INV-/2026" number and never constructs a
  // dynamic regular expression from an empty value.
  const clean = (value) => String(value || '').replace(/^[\s./_-]+|[\s./_-]+$/g, '');
  const parts = [clean(prefix)];
  if (numbering.includeDocumentTypeCode) parts.push(clean(numbering.documentTypeCode));
  if (datePart) parts.push(datePart);
  if (numbering.includeBranchCode) parts.push(clean(numbering.branchCode || 'BR'));
  if (numbering.includeLocationCode) parts.push(clean(numbering.locationCode || 'LOC'));
  parts.push(body);
  if (suffix) parts.push(clean(suffix));
  return parts.filter(Boolean).join(separator);
};

/** `offset` numbers a run of documents created in one go (e.g. an import). */
export const generateVoucherNumber = ({ db, company, voucherKey, branchId = null, offset = 0 }) => {
  const settings = getDocSettings(db, company, { branchId });
  const numbering = settings?.numbering?.[voucherKey];
  if (!numbering) return '';
  if (String(numbering.mode || '').toLowerCase() === 'manual') return '';
  return formatVoucherNumberPreview(numbering, offset);
};

/**
 * The next number that is actually free.
 *
 * The stored counter can fall behind what the book contains — an import, a
 * restored backup, or a voucher created before the counter existed. Trusting it
 * blindly makes every new voucher collide with an existing number and the save
 * is refused, which reads to the user as "the form does not work". Walking
 * forward past taken numbers heals that without touching their data.
 */
export const nextFreeVoucherNumber = ({ db, company, voucherKey, branchId = null, takenNumbers = [] }) => {
  const settings = getDocSettings(db, company, { branchId });
  const numbering = settings?.numbering?.[voucherKey];
  if (!numbering) return '';
  if (String(numbering.mode || '').toLowerCase() === 'manual') return '';

  const taken = new Set(
    (Array.isArray(takenNumbers) ? takenNumbers : []).map((n) => String(n || '').trim()).filter(Boolean)
  );

  // Bounded so a pathological book can never spin the UI.
  for (let offset = 0; offset < 10000; offset += 1) {
    const candidate = formatVoucherNumberPreview(numbering, offset);
    if (!taken.has(candidate)) return candidate;
  }
  return formatVoucherNumberPreview(numbering);
};

export const parseVoucherNumberInt = (value, { prefix = '', suffix = '' } = {}) => {
  const s = String(value || '').trim();
  const p = String(prefix || '');
  const suf = String(suffix || '');
  if (p && !s.startsWith(p)) return null;
  if (suf && !s.endsWith(suf)) return null;
  const core = s.slice(p.length, suf ? -suf.length : undefined).trim();
  if (!core) return null;
  const n = parseInt(core, 10);
  return Number.isFinite(n) ? n : null;
};

export const bumpCompanyNextNumber = ({ db, companyId, voucherKey, usedNumber, branchId = null }) => {
  const company = db.companies.find((c) => c.id === companyId);
  if (!company) return db.companies;

  const currentSettings = getDocSettings(db, company, { branchId });
  const currentNumbering = currentSettings?.numbering?.[voucherKey];
  if (!currentNumbering || String(currentNumbering.mode || '').toLowerCase() !== 'auto') return db.companies;

  const parsed = parseVoucherNumberInt(usedNumber, currentNumbering);
  const nextCandidate = parsed !== null ? parsed + 1 : Number(currentNumbering.nextNumber || 1) + 1;
  const nextNumber = Math.max(Number(currentNumbering.nextNumber || 1), Number(nextCandidate || 1));

  return db.companies.map((c) => {
    if (c.id !== companyId) return c;

    const baseDoc = (c?.docSettings && typeof c.docSettings === 'object') ? c.docSettings : {};
    const normalizedBranchId = branchId ? String(branchId).trim() : '';

    if (normalizedBranchId) {
      const prevByBranch = (baseDoc?.numberingByBranch && typeof baseDoc.numberingByBranch === 'object') ? baseDoc.numberingByBranch : {};
      const prevBranchNum = (prevByBranch?.[normalizedBranchId] && typeof prevByBranch[normalizedBranchId] === 'object') ? prevByBranch[normalizedBranchId] : {};
      const currentMerged = getDocSettings(db, c, { branchId: normalizedBranchId });
      const prevCfg = prevBranchNum?.[voucherKey] || currentMerged?.numbering?.[voucherKey] || {};
      const nextByBranch = {
        ...prevByBranch,
        [normalizedBranchId]: {
          ...prevBranchNum,
          [voucherKey]: {
            ...prevCfg,
            nextNumber,
          },
        },
      };

      return {
        ...c,
        docSettings: {
          ...baseDoc,
          numberingByBranch: nextByBranch,
        },
      };
    }

    const currentMerged = getDocSettings(db, c);
    const merged = {
      ...baseDoc,
      ...currentMerged,
      numbering: {
        ...(currentMerged?.numbering || {}),
        [voucherKey]: {
          ...(currentMerged?.numbering?.[voucherKey] || {}),
          nextNumber,
        },
      },
    };
    return {
      ...c,
      docSettings: merged,
    };
  });
};
