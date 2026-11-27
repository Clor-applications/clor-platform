import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CtcSplit, MonthTodo, lockWords, monthSteps, nextMonthName, splitLines } from '../apps/payroll/src/components/round59';
import { DayQuickFix, canQuickFix } from '../apps/attendance/src/components/round59';
import { LeaveRules, ruleLine } from '../apps/attendance/src/portal/LeaveRules';
import ToFinish from '../apps/people/src/workforce/ToFinish';
import { detailsToFinish, probationHint } from '../apps/people/src/workforce/round59';
import { getSalaryStructure, previewSalaryStructure } from '../apps/payroll/src/api/payrollStructures';
import { markDay, setExceptionState } from '../apps/attendance/src/api/attendance';

vi.mock('../apps/payroll/src/api/payrollStructures', () => ({ getSalaryStructure: vi.fn(), previewSalaryStructure: vi.fn() }));
vi.mock('../apps/attendance/src/api/attendance', () => ({ markDay: vi.fn(), setExceptionState: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

describe('lockexplain A: what locking does, before it happens', () => {
  it('names the month and where a later fix goes', () => {
    expect(nextMonthName('2026-10-31')).toBe('November');
    expect(nextMonthName('2026-12-31T00:00:00.000Z')).toBe('January');
    const w = lockWords({ period: { name: 'October 2026', endDate: '2026-10-31' } });
    expect(w.title).toBe('Lock October 2026?');
    expect(w.message).toContain('nobody can change this pay run');
    expect(w.message).toContain("November's payroll as an adjustment");
    expect(lockWords({}).message).toContain("next month's payroll");
  });
});

describe('monthflow C: the month as a to-do list', () => {
  it('ticks the steps the run has passed', () => {
    expect(monthSteps(undefined).every((s) => !s.done)).toBe(true);
    expect(monthSteps('CALCULATED').filter((s) => s.done).map((s) => s.key)).toEqual(['start', 'calc']);
    expect(monthSteps('POSTED').every((s) => s.done)).toBe(true);
  });
  it('shows the count and links the next step', async () => {
    const onOpen = vi.fn();
    render(<MonthTodo period={{ name: 'October 2026' }} run={{ id: 'october-run', status: 'APPROVED' }} onOpen={onOpen} />);
    expect(screen.getByRole('heading', { name: 'October 2026 to-do' })).toBeInTheDocument();
    expect(screen.getByText('3 of 6 done')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Lock the month/ }));
    expect(onOpen).toHaveBeenCalledWith('runs', { runId: 'october-run' });
  });
  it('is not drawn without a period', () => {
    const { container } = render(<MonthTodo period={null} run={null} onOpen={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ctcsplit A: one CTC in, every part out', () => {
  it('keeps earnings above zero, then gross and net', () => {
    const s = splitLines({ lines: [{ type: 'EARNING', name: 'Basic', amount: 25000 }, { type: 'DEDUCTION', name: 'PF', amount: 1800 }, { type: 'EARNING', name: 'Bonus', amount: 0 }], grossEarnings: 50000, netPay: 43180 });
    expect(s.earnings.map((l) => l.name)).toEqual(['Basic']);
    expect(s).toMatchObject({ gross: 50000, net: 43180 });
  });
  it('previews the chosen structure at the typed CTC', async () => {
    vi.mocked(getSalaryStructure).mockResolvedValue({ frequency: 'MONTHLY', components: [{ componentId: 'c1', percentage: '50', isBalancing: false, displayOrder: 1 }] });
    vi.mocked(previewSalaryStructure).mockResolvedValue({ lines: [{ componentId: 'c1', type: 'EARNING', name: 'Basic', amount: 25000 }], grossEarnings: 50000, netPay: 43180 });
    render(<CtcSplit structureId="s1" annualCtc="600000" />);
    expect(await screen.findByText('Basic')).toBeInTheDocument();
    expect(screen.getByText('Net pay')).toBeInTheDocument();
    expect(screen.getByText('₹43,180.00')).toBeInTheDocument();
    expect(previewSalaryStructure).toHaveBeenCalledWith(expect.objectContaining({ annualCtc: 600000, components: [expect.objectContaining({ componentId: 'c1', percentage: 50 })] }));
  });
  it('says nothing until a CTC is typed', () => {
    const { container } = render(<CtcSplit structureId="s1" annualCtc="0" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('attexceptions A: deciding a day from the list', () => {
  const item = { key: 'NO_RECORD:e1:2026-11-12', kind: 'NO_RECORD', status: 'OPEN', employeeId: 'e1', employeeName: 'Ravi', date: '2026-11-12' };
  it('is offered only for a day with nothing on it', () => {
    expect(canQuickFix(item)).toBe(true);
    expect(canQuickFix({ ...item, kind: 'MISSING_OUT' })).toBe(false);
    expect(canQuickFix({ ...item, status: 'RESOLVED' })).toBe(false);
  });
  it('marks the day unpaid and settles the item', async () => {
    vi.mocked(markDay).mockResolvedValue({});
    vi.mocked(setExceptionState).mockResolvedValue({});
    const onDone = vi.fn();
    render(<DayQuickFix item={item} onDone={onDone} />);
    await userEvent.click(screen.getByRole('button', { name: 'Unpaid: Ravi, 2026-11-12' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(markDay).toHaveBeenCalledWith(expect.objectContaining({ employeeId: 'e1', date: '2026-11-12', status: 'ABSENT', checkIn: null }));
    expect(setExceptionState).toHaveBeenCalledWith(expect.objectContaining({ key: item.key, status: 'RESOLVED' }));
  });
});

describe('leavepolicyread A: My leave rules', () => {
  it('says each type in one line', () => {
    expect(ruleLine({ isPaid: true, entitled: 12, carryLimit: 6, credits: [{}], allowHalfDay: true })).toBe('12 days a year · earned through the year · up to 6 carry over · half days allowed');
    expect(ruleLine({ isPaid: true, entitled: 12, carryLimit: 0 })).toBe('12 days a year · no carry over');
    expect(ruleLine({ isPaid: false })).toBe('unpaid');
  });
  it('lists the types under a summary', () => {
    render(<LeaveRules types={[{ id: 't1', name: 'Sick', isPaid: true, entitled: 12, carryLimit: 0 }]} />);
    expect(screen.getByText('My leave rules')).toBeInTheDocument();
    expect(screen.getByText('Sick')).toBeInTheDocument();
    expect(screen.getByText('12 days a year · no carry over')).toBeInTheDocument();
  });
});

describe('quickadd A and probationend A', () => {
  it('lists what a record added in a hurry still needs', () => {
    const p = { status: 'ACTIVE', firstName: 'Asha', phone: '98765 43210', department: 'Sales' };
    expect(detailsToFinish(p).map((d) => d.label)).toEqual(['Email', 'Date of birth', 'Gender', 'Emergency contact', 'Designation', 'Manager']);
    expect(detailsToFinish({ ...p, status: 'LEFT' })).toEqual([]);
    expect(detailsToFinish({ ...p, personalHidden: true }).map((d) => d.key)).not.toContain('dateOfBirth');
  });
  it('opens the place a missing detail is filled in', async () => {
    const go = vi.fn();
    render(<ToFinish person={{ status: 'ACTIVE', phone: '1', workEmail: 'a@b.c', dateOfBirth: '1990-01-01', gender: 'F', emergencyContactPhone: '2', department: 'Sales', designation: 'Rep' }} canEdit go={go} />);
    expect(screen.getByText('1 detail to finish')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Manager' }));
    expect(go).toHaveBeenCalledWith({ tab: 'organization', edit: null, action: 'transfer' });
  });
  it('is not drawn for someone who cannot edit', () => {
    const { container } = render(<ToFinish person={{ status: 'ACTIVE' }} canEdit={false} go={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('explains a worked-out probation date only while it is that date', () => {
    expect(probationHint({ probationEndDate: '2027-05-18' }, '2027-05-18', 6)).toBe('6 months from joining, from the employment type. Change it if needed.');
    expect(probationHint({ probationEndDate: '2027-06-01' }, '2027-05-18', 6)).toBe('');
    expect(probationHint({ probationEndDate: '' }, '', 6)).toBe('');
  });
});
