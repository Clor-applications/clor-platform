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
