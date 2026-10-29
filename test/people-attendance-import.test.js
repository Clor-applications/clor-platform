import { describe, expect, it } from 'vitest';

import { matchColumns, normaliseTimeColumns, rowsByColumn, toHHMM, toStatus } from '../packages/ui/src/utils/importColumns';
import { excelFractionToHHMM } from '../packages/ui/src/utils/xlsx';

/* Batch 2, ERPNext gap 5: an attendance sheet as people keep it, read without retyping. */
const COLUMNS = [
  { key: 'employeeCode', label: 'Employee code', aliases: ['Emp code', 'Employee ID'] },
  { key: 'date', label: 'Date (15/10/2026 or 2026-10-15)' },
  { key: 'checkIn', label: 'In (09:05)', aliases: ['In time', 'Check in'] },
  { key: 'checkOut', label: 'Out (18:10)', aliases: ['Out time'] },
  { key: 'status', label: 'Status' },
];

describe('matching a sheet’s own headings', () => {
  it('matches keys, labels without their hint, and other names, ignoring case and punctuation', () => {
    const m = matchColumns(['EMP CODE', 'Date', 'In-Time', 'out time', 'Remarks', 'checkIn'], COLUMNS);
    expect([...m]).toEqual([['EMP CODE', 'employeeCode'], ['Date', 'date'], ['In-Time', 'checkIn'], ['out time', 'checkOut']]);
  });
  it('keys rows from either reader, leaving unmatched columns out', () => {
    const m = matchColumns(['Emp code', 'In time', 'Shift'], COLUMNS);
    expect(rowsByColumn(['Emp code', 'In time', 'Shift'], [['E-1', ' 9:05 ', 'G']], m)).toEqual([{ employeeCode: 'E-1', checkIn: '9:05' }]);
    expect(rowsByColumn(['Emp code', 'In time', 'Shift'], [{ 'Emp code': 'E-2', 'In time': '10:00', Shift: 'N' }], m)).toEqual([{ employeeCode: 'E-2', checkIn: '10:00' }]);
  });
});

describe('reading times and statuses as people type them', () => {
  it('reads times in the usual shapes and refuses what is not a time', () => {
    expect(['9:30', '09.30', '0930', '930', '9', '9:30 am', '6:10 PM', '12:05 am', '12:30 pm', '09:30:15', '0.395833', '2026-10-15 09:30', '15/10/2026 18:45'].map(toHHMM))
      .toEqual(['09:30', '09:30', '09:30', '09:30', '09:00', '09:30', '18:10', '00:05', '12:30', '09:30', '09:30', '09:30', '18:45']);
    expect(['', 'late', '25:00', '13:00 pm', '9:75'].map(toHHMM)).toEqual([null, null, null, null, null]);
  });
  it('rewrites only the time columns it can read, so the check names the rest', () => {
    expect(normaliseTimeColumns([{ checkIn: '9.05', checkOut: 'forgot', note: '9.05' }], ['checkIn', 'checkOut'])).toEqual([{ checkIn: '09:05', checkOut: 'forgot', note: '9.05' }]);
  });
  it('turns P, A, HD, Leave and WO into CLOR’s words', () => {
    expect(['P', 'a', 'HD', 'Half day', 'Leave', 'WO', 'present', '', 'Sick'].map(toStatus)).toEqual(['PRESENT', 'ABSENT', 'HALF_DAY', 'HALF_DAY', 'ON_LEAVE', 'WEEKLY_OFF', 'PRESENT', '', 'Sick']);
  });
  it('reads an Excel time cell (a fraction of the day) as HH:MM', () => {
    expect(excelFractionToHHMM(0.375)).toBe('09:00');
    expect(excelFractionToHHMM(46329.7583333)).toBe('18:12');
  });
});
