export const nextNumericCode = (rows, start, end) => {
  const used = new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => String(row?.code || '').trim())
      .filter((code) => /^\d+$/.test(code)),
  );
  for (let value = start; value <= end; value += 1) {
    const code = String(value);
    if (!used.has(code)) return code;
  }
  return '';
};

export const nextCustomerCode = (rows) => nextNumericCode(rows, 200000, 599999);
export const nextVendorCode = (rows) => nextNumericCode(rows, 600000, 999999);
export const isValidCustomerCode = (value) => /^[2-5]\d{5}$/.test(String(value || '').trim());

export const PARTY_CODE_COMPONENTS = ['prefix', 'branch', 'year', 'sequence', 'suffix'];

export const partyCodeFormat = (company, kind) => ({
  prefix: kind === 'vendor' ? 'VEND' : 'CUST', suffix: '', separator: '-', digits: 5, nextNumber: 1,
  mode: 'automatic', includeBranchCode: false, includeYear: false, componentOrder: PARTY_CODE_COMPONENTS,
  ...(company?.profile?.partyCodeSettings?.[kind] || {}),
});

export const formatPartyCode = (format, number, branchCode = '', date = new Date()) => {
  const separator = format.separator ?? '-';
  const values = { prefix: format.prefix, branch: format.includeBranchCode ? branchCode : '', year: format.includeYear ? String(date.getFullYear()).slice(-2) : '', sequence: String(number).padStart(Number(format.digits) || 1, '0'), suffix: format.suffix };
  const order = Array.isArray(format.componentOrder) && format.componentOrder.length === PARTY_CODE_COMPONENTS.length && new Set(format.componentOrder).size === PARTY_CODE_COMPONENTS.length && format.componentOrder.every((part) => PARTY_CODE_COMPONENTS.includes(part)) ? format.componentOrder : PARTY_CODE_COMPONENTS;
  const parts = order.map((part) => values[part]).filter(Boolean);
  return parts.join(separator);
};

export const nextPartyCode = (rows, company, kind, branchCode = '') => {
  const format = partyCodeFormat(company, kind);
  const { nextNumber } = format;
  const used = new Set((rows || []).filter((row) => String(row.companyId) === String(company?.id)).map((row) => String(row.code || '')));
  for (let number = Number(nextNumber) || 1; number <= 9999999999; number += 1) {
    const code = formatPartyCode(format, number, branchCode);
    if (!used.has(code)) return code;
  }
  return '';
};

export const isValidPartyCode = (value) => /^[A-Za-z0-9_/-]+$/.test(String(value || '').trim()) && (String(value || '').match(/\d/g) || []).length <= 10;
