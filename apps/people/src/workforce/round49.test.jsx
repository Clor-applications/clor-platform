import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImportProgress, ImportReadNotes, dateExample, guessImportColumns, readSheetDate, sheetFromTool } from './round49';

/* Round 49 picks (18 Nov 2026): other tools' sheets, dates read day first, import progress. */

describe('a sheet from another HR tool', () => {
  it('names the tool and matches its columns', () => {
    const headers = ['Employee No', 'Employee Name', 'Date of Joining', 'Reporting Manager No', 'Official Email ID', 'Mobile No'];
    expect(sheetFromTool(headers).tool).toBe('greytHR');
    expect(guessImportColumns(headers)).toEqual(['code', 'name', 'dateOfJoining', 'managerCode', 'workEmail', 'phone']);
  });
  it('keeps our own names and never sends two columns to one field', () => {
    expect(sheetFromTool(['name', 'code'])).toBeNull();
    expect(guessImportColumns(['Employee ID', 'Emp Code', 'Name'])).toEqual(['code', '', 'name']);
  });
});

describe('dates in the sheet', () => {
  it('reads day first, like the server', () => {
    expect(readSheetDate('05/10/2026')).toEqual({ y: 2026, m: 10, d: 5 });
    expect(readSheetDate('5 Oct 2026')).toEqual({ y: 2026, m: 10, d: 5 });
    expect(readSheetDate('2026-10-05')).toEqual({ y: 2026, m: 10, d: 5 });
    expect(readSheetDate('Oct 5')).toBeNull();
  });
  it('shows one example from the first mapped date column', () => {
    const file = { headers: ['Name', 'DOJ'], rows: [['Asha', ''], ['Ravi', '03/04/2025']] };
    expect(dateExample(file, ['name', 'dateOfJoining'])).toEqual({ column: 'DOJ', raw: '03/04/2025', words: '3 Apr 2025' });
    render(<ImportReadNotes file={file} mapping={['name', 'dateOfJoining']} />);
    expect(screen.getByRole('note')).toHaveTextContent('Dates are read day first: 03/04/2025 in DOJ is 3 Apr 2025');
  });
  it('says so when a date column cannot be read', () => {
    const file = { headers: ['Joined'], rows: [['13/13/2025']] };
    expect(dateExample(file, ['dateOfJoining']).words).toBeNull();
  });
});

describe('a big import running', () => {
  it('shows a bar and asks to stay', () => {
    render(<ImportProgress rows={140} />);
    expect(screen.getByRole('status')).toHaveTextContent('Importing 140 rows. Stay on this page until it finishes.');
  });
});
