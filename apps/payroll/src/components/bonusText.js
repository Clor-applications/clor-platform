/** Statutory bonus helpers (round 66 pick), kept apart from the screen. */

/** "2026-27" for a date: the financial year it falls in. */
export const yearOf = (d) => {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

/** The financial year `n` years before `fy`. */
export const yearsBack = (fy, n) => {
  const start = Number(fy.slice(0, 4)) - n;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

/** Form C (Payment of Bonus Rules 1975): the register's columns, in its order. */
export const REGISTER_COLUMNS = [
  { key: 'serial', label: 'Sl. No.' },
  { key: 'name', label: 'Name of the employee' },
  { key: 'code', label: 'Employee code' },
  { key: 'fatherName', label: "Father's name" },
  { key: 'designation', label: 'Designation' },
  { key: 'daysWorked', label: 'Days worked in the year' },
  { key: 'wages', label: 'Total salary or wage in the year' },
  { key: 'bonusPayable', label: 'Bonus payable (s.10 or s.11)' },
  { key: 'customaryBonus', label: 'Puja or other customary bonus paid in the year' },
  { key: 'interimBonus', label: 'Interim bonus or bonus paid in advance' },
  { key: 'incomeTax', label: 'Income tax deducted' },
  { key: 'lossDeduction', label: 'Deduction for financial loss caused by misconduct' },
  { key: 'totalDeductions', label: 'Total deducted' },
  { key: 'netPayable', label: 'Net amount payable' },
  { key: 'amountPaid', label: 'Amount actually paid' },
  { key: 'paidOn', label: 'Date paid' },
  { key: 'signature', label: 'Signature or thumb impression', value: () => '' },
];
