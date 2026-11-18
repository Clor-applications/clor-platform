import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { forgetChoices, indianDigits, installFormRules, isIdentifierField, lastChoices, properName, rawDigits, rememberChoices } from './round56';
import MoneyInput from '../components/ui/MoneyInput';
import { LeavingReadBack } from '../personnel/Employees';

describe('round 56: amounts take Indian commas as typed', () => {
  it('groups lakhs and crores, keeps decimals and plain text', () => {
    expect(indianDigits('1250000')).toBe('12,50,000');
    expect(indianDigits('123456789.5')).toBe('12,34,56,789.5');
    expect(indianDigits('999')).toBe('999');
    expect(indianDigits('')).toBe('');
    expect(rawDigits('12,50,000')).toBe('1250000');
  });

  it('MoneyInput shows commas and hands the screen plain digits', () => {
    const seen = [];
    function Field() {
      const [v, setV] = useState('');
      return <MoneyInput aria-label="Salary" type="number" value={v} onChange={(e) => { seen.push(e.target.value); setV(e.target.value); }} />;
    }
    render(<Field />);
    const box = screen.getByLabelText('Salary');
    fireEvent.change(box, { target: { value: '1250000' } });
    expect(box.value).toBe('12,50,000');
    expect(box.type).toBe('text');
    fireEvent.change(box, { target: { value: '12,50,0001' } });
    expect(seen.at(-1)).toBe('12500001');
    expect(box.value).toBe('1,25,00,001');
    fireEvent.change(box, { target: { value: '12a' } });
    expect(box.value).toBe('1,25,00,001');
  });
});

describe('round 56: names typed in capitals', () => {
  it('offers the proper case only for all-capital names', () => {
    expect(properName('RAVI KUMAR')).toBe('Ravi Kumar');
    expect(properName("O'NEIL D'SOUZA")).toBe("O'Neil D'Souza");
    expect(properName('Ravi Kumar')).toBeNull();
    expect(properName('AB')).toBeNull();
  });
});

describe('round 56: form rules on the document', () => {
  let undo = () => {};
  afterEach(() => { undo(); document.body.innerHTML = ''; });

  it('turns a PAN, IFSC or GSTIN to capitals as it is typed, and the screen hears the capitals', () => {
    undo = installFormRules();
    const heard = [];
    function Form() {
      const [pan, setPan] = useState('');
      return <label>PAN<input value={pan} onChange={(e) => { heard.push(e.target.value); setPan(e.target.value); }} /></label>;
    }
    render(<Form />);
    const box = screen.getByLabelText('PAN');
    expect(isIdentifierField(box)).toBe(true);
    fireEvent.input(box, { target: { value: 'abcde1234f' } });
    expect(box.value).toBe('ABCDE1234F');
    expect(heard.at(-1)).toBe('ABCDE1234F');
  });

  it('leaves other fields as typed', () => {
    render(<label>Name<input defaultValue="" /></label>);
    expect(isIdentifierField(screen.getByLabelText('Name'))).toBe(false);
  });

  it('Enter moves to the next field and never sends a long form', () => {
    undo = installFormRules();
    let sent = 0;
    render(
      <form onSubmit={(e) => { e.preventDefault(); sent += 1; }}>
        <input aria-label="One" /><input aria-label="Two" /><input aria-label="Three" />
        <button type="submit">Save</button>
      </form>,
    );
    const one = screen.getByLabelText('One');
    one.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    one.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('Two'));
    const three = screen.getByLabelText('Three');
    const last = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    three.dispatchEvent(last);
    expect(last.defaultPrevented).toBe(true);
    expect(sent).toBe(0);
  });

  it('a short form (sign-in, one reason) still sends from its last field', () => {
    undo = installFormRules();
    render(<form><input aria-label="Email" /><input aria-label="Password" type="password" /></form>);
    const pw = screen.getByLabelText('Password');
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    pw.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe('round 56: the last choices start the next person', () => {
  afterEach(() => forgetChoices());
  it('keeps ids only and drops blanks', () => {
    rememberChoices({ branchId: 'b1', departmentId: '', firstName: 'Ravi', employeeTypeId: 't1' });
    expect(lastChoices()).toEqual({ branchId: 'b1', employeeTypeId: 't1' });
  });
});

describe('round 56: leaving is read back before it is recorded', () => {
  it('says the last day, why and the notice in plain words, with Change links', () => {
    render(<LeavingReadBack person={{ name: 'Meena Iyer' }} form={{ leavingType: 'RESIGNED', lastDay: '2099-12-31', reason: 'Handover to Arjun' }} today="2026-11-18" resignedOn="2026-11-01" short={3} />);
    const box = screen.getByRole('region', { name: 'Before you record' });
    expect(box.textContent).toContain('Meena Iyer works until 31 Dec 2099');
    expect(box.textContent).toContain('3 days of notice short');
    expect(box.textContent).toContain('Note: Handover to Arjun');
    expect(screen.getAllByRole('button', { name: 'Change' }).length).toBe(3);
  });
});
