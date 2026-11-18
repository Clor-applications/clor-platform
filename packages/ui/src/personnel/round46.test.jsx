import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DOC_FOLDERS, docFolders, folderOf, nextMonthRange, expiresNextMonth, fieldWords, LetterFieldsPreview } from './round46';

/* Round 46 picks (18 Nov 2026): document folders, next month's expiries, letter fields as chips. */

describe('document folders', () => {
  it('puts each kind in its folder, unknown kinds in Other', () => {
    expect(folderOf('ID_PROOF')).toBe('Identity');
    expect(folderOf('CONTRACT')).toBe('Joining');
    expect(folderOf('LETTER')).toBe('Letters');
    expect(folderOf('PAYSLIP')).toBe('Payroll');
    expect(folderOf('SOMETHING_NEW')).toBe('Other');
    expect(DOC_FOLDERS.map(([n]) => n)).toEqual(['Identity', 'Joining', 'Letters', 'Payroll', 'Other']);
  });
  it('groups in folder order, skips empty folders, keeps the list order inside', () => {
    const docs = [{ id: 1, kind: 'LETTER' }, { id: 2, kind: 'ID_PROOF' }, { id: 3, kind: 'OTHER' }, { id: 4, kind: 'ADDRESS_PROOF' }];
    const g = docFolders(docs);
    expect(g.map((f) => f.name)).toEqual(['Identity', 'Letters', 'Other']);
    expect(g[0].docs.map((d) => d.id)).toEqual([2, 4]);
  });
});

describe('next month’s expiries', () => {
  it('names the whole next calendar month, across a year end', () => {
    expect(nextMonthRange('2026-11-18')).toMatchObject({ from: '2026-12-01', to: '2026-12-31', label: 'December 2026' });
    expect(nextMonthRange('2026-12-05')).toMatchObject({ from: '2027-01-01', to: '2027-01-31' });
    expect(nextMonthRange('2027-01-31')).toMatchObject({ from: '2027-02-01', to: '2027-02-28' });
  });
  it('counts only documents running out inside that month', () => {
    expect(expiresNextMonth({ expiresOn: '2026-12-15' }, '2026-11-18')).toBe(true);
    expect(expiresNextMonth({ expiresOn: '2026-11-30' }, '2026-11-18')).toBe(false);
    expect(expiresNextMonth({ expiresOn: '2027-01-01' }, '2026-11-18')).toBe(false);
    expect(expiresNextMonth({}, '2026-11-18')).toBe(false);
  });
});

describe('letter fields as chips', () => {
  afterEach(() => { delete document.documentElement.dataset.palette; });
  it('reads a field code as plain words', () => {
    expect(fieldWords('dateOfJoining')).toBe('Date of joining');
    expect(fieldWords('extra.effective_date')).toBe('Effective date');
    expect(fieldWords('name')).toBe('Name');
  });
  it('draws each {{field}} as a grey chip in the letter as it reads', () => {
    render(<LetterFieldsPreview body={'Dear {{name}}, your pay from {{extra.effective_date}} is revised.'} />);
    const region = screen.getByRole('region', { name: 'How the letter reads' });
    expect(region).toHaveTextContent('Dear Name, your pay from Effective date is revised.');
    expect(region.querySelectorAll('.ui-merge-chip')).toHaveLength(2);
  });
  it('is not drawn without fields, or in Books', () => {
    const { container, rerender } = render(<LetterFieldsPreview body="Plain letter." />);
    expect(container).toBeEmptyDOMElement();
    document.documentElement.dataset.palette = 'indigo';
    rerender(<LetterFieldsPreview body="Dear {{name}}" />);
    expect(container).toBeEmptyDOMElement();
  });
});
