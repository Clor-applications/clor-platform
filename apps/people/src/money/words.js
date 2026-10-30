/* Words and figures shared by the money screens. */
export const MONEY_TYPES = { EXPENSE_CLAIM: 'Expense claim', EMPLOYEE_ADVANCE: 'Advance', SALARY_ADVANCE: 'Salary advance' };
export const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
