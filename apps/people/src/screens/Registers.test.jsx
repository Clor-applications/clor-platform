import { expect, it } from 'vitest';

import { showRegisterValue } from './Registers';

/* People plan 8 Nov 2026, §3 rule 7: the register reads "Female" and "31 Dec 2023", not MALE and 2023-12-31. */
it('says a gender as a word and a stored date as people read it, and leaves everything else alone', () => {
  expect(showRegisterValue('MALE')).toBe('Male');
  expect(showRegisterValue('FEMALE')).toBe('Female');
  expect(showRegisterValue('OTHER')).toBe('Other');
  expect(showRegisterValue('2023-12-31')).toBe('31 Dec 2023');
  expect(showRegisterValue('MF-001')).toBe('MF-001');
  expect(showRegisterValue('see Payroll')).toBe('see Payroll');
  expect(showRegisterValue('')).toBe('');
  expect(showRegisterValue(null)).toBe('');
  expect(showRegisterValue(12)).toBe('12');
});
