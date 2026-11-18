import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LeaveQuestions, SettingHelp, ShiftBar, questionsFor, settingHits, shiftPieces } from './round64';
import SettingsHub from '../settings/SettingsHub';
import { PeriodLocked } from '../timeOff/LeavePolicy';

afterEach(cleanup);

const GROUPS = [
  { title: 'Time off', items: [['attendanceRules', 'Late marks that cost part of a day'], ['leaveTypes', 'Leave types, credits and rules']] },
  { title: 'Organisation', items: [['departments', 'Departments and their heads']] },
];
const NAV = [
  { key: 'attendanceRules', label: 'Attendance rules' },
  { key: 'leaveTypes', label: 'Leave policy', keywords: ['holiday allowance'] },
  { key: 'departments', label: 'Departments' },
];
const WORDS = { attendanceRules: ['grace', 'late mark'], leaveTypes: ['sandwich rule'] };

describe('round 64: settingsfind A', () => {
  it('finds a setting by a word inside it and says where it lives', () => {
    const byKey = new Map(NAV.map((i) => [i.key, i]));
    expect(settingHits('grace', WORDS, GROUPS, byKey)).toEqual([{ key: 'attendanceRules', word: 'grace', label: 'Attendance rules', group: 'Time off' }]);
    expect(settingHits('sand', WORDS, GROUPS, byKey)[0]).toMatchObject({ key: 'leaveTypes', word: 'sandwich rule' });
    /* A word already in the setting's own name or line is a plain match, not a "found inside". */
    expect(settingHits('late', WORDS, GROUPS, byKey)).toEqual([]);
    expect(settingHits('g', WORDS, GROUPS, byKey)).toEqual([]);
    /* The nav item's own keywords count too. */
    expect(settingHits('allowance', {}, GROUPS, byKey)[0]).toMatchObject({ key: 'leaveTypes', word: 'holiday allowance' });
  });

  it('lists "grace → Time off › Attendance rules" under the search and opens the page', () => {
    const openScreen = vi.fn();
    render(<SettingsHub groups={GROUPS} navItems={NAV} words={WORDS} openScreen={openScreen} />);
    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'grace' } });
    const hit = screen.getByRole('button', { name: /grace → Time off › Attendance rules/ });
    fireEvent.click(hit);
    expect(openScreen).toHaveBeenCalledWith('attendanceRules');
    /* The setting's own row stays in the list too, and nothing unrelated shows. */
    expect(screen.getByRole('button', { name: /^Attendance rules/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Departments/ })).toBeNull();
  });
});

describe('round 64: settinghelp C', () => {
  it('opens the Help centre on the setting\'s how-to', () => {
    const seen = vi.fn();
    window.addEventListener('clor:open-help', seen);
    render(<SettingHelp topic="leave-types" label="the sandwich rule" />);
    fireEvent.click(screen.getByRole('button', { name: 'How the sandwich rule works' }));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].detail).toEqual({ topic: 'leave-types' });
    window.removeEventListener('clor:open-help', seen);
  });
});

describe('round 64: shiftsetup A', () => {
  it('splits a night shift at midnight and says it ends the next day', () => {
    expect(shiftPieces('09:00', '18:00')).toEqual({ pieces: [[540, 1080]], night: false, minutes: 540 });
    expect(shiftPieces('22:00', '06:00')).toEqual({ pieces: [[1320, 1440], [0, 360]], night: true, minutes: 480 });
    render(<ShiftBar start="22:00" end="06:00" />);
    expect(screen.getByRole('img', { name: 'Shift 22:00 to 06:00 · ends next day · 8 h' })).toBeTruthy();
    expect(screen.getByText('22:00 to 06:00 · ends next day · 8 h')).toBeTruthy();
  });

  it('draws nothing for a shift with no length', () => {
    const { container } = render(<ShiftBar start="09:00" end="09:00" />);
    expect(container.innerHTML).toBe('');
  });
});

function Harness({ onDone }) {
  const [form, setForm] = useState({ name: '', isPaid: true, annualDays: 12, gender: '', carryForwardMax: '', attachmentAfterDays: '' });
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <>
      <LeaveQuestions form={form} set={set} onDone={onDone} />
      <output data-testid="form">{JSON.stringify(form)}</output>
    </>
  );
}

describe('round 64: leavetypesetup A', () => {
  it('asks the plain questions one after another and fills the form', () => {
    const onDone = vi.fn();
    render(<Harness onDone={onDone} />);
    expect(screen.getByText('Question 1 of 6')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Marriage leave' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Is it paid?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('Days a year'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Everyone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'No, they lapse' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, for longer leave' }));
    fireEvent.click(screen.getByRole('button', { name: 'See the full form' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(JSON.parse(screen.getByTestId('form').textContent)).toMatchObject({ name: 'Marriage leave', isPaid: true, annualDays: 3, gender: '', carryForwardMax: '', attachmentAfterDays: 2 });
  });

  it('skips the paid-only questions for unpaid leave', () => {
    expect(questionsFor({ isPaid: false }).map((q) => q.key)).toEqual(['name', 'paid', 'who', 'proof']);
    expect(questionsFor({ isPaid: true })).toHaveLength(6);
  });

  it('"Show every setting" opens the full form at once', () => {
    const onDone = vi.fn();
    render(<Harness onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show every setting' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('round 64: settingslocked A', () => {
  it('says the leave period is locked, why, and what to do', () => {
    render(<PeriodLocked />);
    expect(screen.getByRole('note').textContent).toMatch(/locked.*leave is already recorded.*balances move first/);
  });
});
