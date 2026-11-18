import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const time = vi.hoisted(() => ({
  getLeaveBalances: vi.fn(),
  listLeaveRequests: vi.fn(),
  listRecords: vi.fn(),
}));
vi.mock('@ui/timeOff/api', () => ({ ...time, swatchOf: () => '#999' }));
vi.mock('@ui/utils/dates', () => ({ todayIst: () => '2026-11-18' }));
const pay = vi.hoisted(() => ({ listAssignments: vi.fn() }));
vi.mock('../../../payroll/src/api/payrollPeople', () => pay);

import { leaveToday, monthLine, neighbours, saveRecordList, readRecordList, tabForQuery } from '@ui/picks/round62';
import { LeftBand, OnLeaveToday, PayTab, PhoneFact, RecordStepper, TimeTab } from './round62';

afterEach(() => { cleanup(); vi.clearAllMocks(); sessionStorage.clear(); });

describe('round 62 helpers', () => {
  it('searchtotab: a phone, e-mail or PAN opens the Personal tab; a name does not', () => {
    expect(tabForQuery('98765 43210')).toBe('personal');
    expect(tabForQuery('ravi@shop.in')).toBe('personal');
    expect(tabForQuery('ABCDE1234F')).toBe('personal');
    expect(tabForQuery('Ravi')).toBeNull();
    expect(tabForQuery('EMP104')).toBeNull();
  });

  it('nextprevrecord: where a person sits in the saved list', () => {
    saveRecordList(['a', 'b', 'c']);
    expect(readRecordList()).toEqual(['a', 'b', 'c']);
    expect(neighbours('b', ['a', 'b', 'c'])).toEqual({ index: 1, total: 3, prev: 'a', next: 'c' });
    expect(neighbours('z', ['a', 'b'])).toBeNull();
    expect(neighbours('a', ['a'])).toBeNull();
  });

  it('timetab: this month in one line', () => {
    const line = monthLine([{ status: 'PRESENT', lateMinutes: 12 }, { status: 'PRESENT' }, { status: 'ON_LEAVE' }, { status: 'ABSENT' }]);
    expect(line.text).toBe('2 present · 1 on leave · 1 absent · 1 late day');
  });

  it('statusbadge: approved leave covering today', () => {
    expect(leaveToday([{ status: 'APPROVED', fromDate: '2026-11-17', toDate: '2026-11-19', leaveTypeName: 'Casual leave' }], '2026-11-18')).toEqual({ type: 'Casual leave', until: '2026-11-19' });
    expect(leaveToday([{ status: 'PENDING', fromDate: '2026-11-18', toDate: '2026-11-18' }], '2026-11-18')).toBeNull();
  });
});

describe('round 62 record parts', () => {
  it('contactactions: the phone is a call link with Copy beside it', () => {
    render(<PhoneFact phone="9876543210" name="Ravi Kumar" />);
    expect(screen.getByRole('link', { name: /98765 43210|9876543210/ }).getAttribute('href')).toBe('tel:+919876543210');
    expect(screen.getByRole('button', { name: 'Copy phone number' })).toBeTruthy();
  });

  it('statusbadge: On leave today with the day they are back', async () => {
    time.listLeaveRequests.mockResolvedValue([{ status: 'APPROVED', fromDate: '2026-11-17', toDate: '2026-11-20', leaveTypeName: 'Sick leave' }]);
    render(<OnLeaveToday employeeId="e1" canRead />);
    expect(await screen.findByText('On leave today')).toBeTruthy();
    expect(screen.getByText(/Sick leave · back after/)).toBeTruthy();
    expect(time.listLeaveRequests).toHaveBeenCalledWith({ employeeId: 'e1', status: 'APPROVED', from: '2026-11-18', to: '2026-11-18' });
  });

  it('nextprevrecord: ‹ › open the people either side, with where this one sits', () => {
    saveRecordList(['a', 'b', 'c']);
    const openScreen = vi.fn();
    render(<RecordStepper id="b" openScreen={openScreen} />);
    expect(screen.getByText('2 of 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next person' }));
    expect(openScreen).toHaveBeenCalledWith('employee', { id: 'c' });
  });

  it('leftrecord: a band with the leaving date and the settlement link', () => {
    render(<LeftBand person={{ status: 'LEFT', dateOfLeaving: '2026-10-31', leavingReason: 'Moved city' }} leavingWord="Resigned" payrollOn openScreen={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Has left' }).textContent).toMatch(/Left on .*Resigned · Moved city/);
    expect(screen.getByRole('link', { name: 'Final settlement' }).getAttribute('href')).toBe('?app=payroll&open=settlements');
  });

  it('timetab: balances, leave coming up and this month', async () => {
    time.getLeaveBalances.mockResolvedValue({ types: [{ id: 't1', name: 'Casual leave' }], rows: [{ employeeId: 'e1', balances: { t1: { available: 4 } } }] });
    time.listLeaveRequests.mockResolvedValue([{ id: 'r1', status: 'PENDING', fromDate: '2026-12-01', toDate: '2026-12-02', leaveTypeName: 'Casual leave' }]);
    time.listRecords.mockResolvedValue([{ status: 'PRESENT' }, { status: 'PRESENT' }]);
    render(<TimeTab person={{ id: 'e1', firstName: 'Ravi' }} canLeave canRecords openScreen={vi.fn()} />);
    expect(await screen.findByText('4 days')).toBeTruthy();
    expect(await screen.findByText('Waiting')).toBeTruthy();
    expect(await screen.findByText('2 present')).toBeTruthy();
  });

  it('salaryonrecord: dots until Show', async () => {
    pay.listAssignments.mockResolvedValue([{ annualCtc: 600000, monthlyCtc: 50000, effectiveFrom: '2026-04-01' }]);
    render(<PayTab person={{ id: 'e1' }} canChange={false} />);
    expect(await screen.findByText('₹ ••••••')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.queryByText('₹ ••••••')).toBeNull();
    expect(screen.getByRole('button', { name: 'Hide' })).toBeTruthy();
  });
});
