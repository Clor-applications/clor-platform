import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('../packages/ui/src/components/ui/notify', () => ({ notify: { error: vi.fn(), success: vi.fn() } }));

import { PermissionContext } from '../packages/ui/src/permissions/context';
import { WriteGuard, readOnlyFor, writeKeysOf } from '../packages/ui/src/permissions/WriteGuard';
import { notify } from '../packages/ui/src/components/ui/notify';

/**
 * The screen-wide guard every app's screens sit in: view-only people see a
 * banner and cannot press what changes things; people who may edit but not
 * approve cannot press Approve or Reject; administrators and unknown
 * permission sets are never blocked.
 */
const ctx = (keys, extra = {}) => ({ loading: false, error: '', permissions: new Set(keys), isAdmin: false, can: (k) => keys.includes(k), ...extra });
const VIEW = 'ATTENDANCE::Attendance Requests::VIEW';

function Screen({ onSave, onApprove, onOther }) {
  return (
    <div>
      <button type="button" className="ui-btn ui-btn-primary" onClick={onSave}>Save</button>
      <button type="button" className="ui-btn ui-btn-secondary" aria-label="Approve Ravi's correction" onClick={onApprove}>✓</button>
      <button type="button" className="ui-btn ui-btn-secondary" onClick={onOther}>Filter</button>
      <button type="button" className="ui-btn ui-btn-secondary" data-permission="PAYROLL::Payroll Runs::APPROVE" onClick={onApprove}>Reject</button>
    </div>
  );
}
const mount = (value) => {
  const fns = { onSave: vi.fn(), onApprove: vi.fn(), onOther: vi.fn() };
  render(
    <PermissionContext.Provider value={value}>
      <WriteGuard permission={VIEW}>
        <Screen {...fns} />
      </WriteGuard>
    </PermissionContext.Provider>,
  );
  return fns;
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WriteGuard', () => {
  it('turns a VIEW permission into its write permissions', () => {
    expect(writeKeysOf(VIEW)).toEqual(['ATTENDANCE::Attendance Requests::EDIT', 'ATTENDANCE::Attendance Requests::CREATE', 'ATTENDANCE::Attendance Requests::DELETE', 'ATTENDANCE::Attendance Requests::APPROVE']);
    expect(writeKeysOf('nonsense')).toEqual([]);
    expect(readOnlyFor(VIEW, ctx([VIEW]))).toBe(true);
    expect(readOnlyFor(VIEW, ctx([VIEW, 'ATTENDANCE::Attendance Requests::EDIT']))).toBe(false);
    expect(readOnlyFor(VIEW, ctx([VIEW], { isAdmin: true }))).toBe(false);
    expect(readOnlyFor(VIEW, ctx([], { loading: true }))).toBe(false);
  });

  it('view only: banner, and Save and Approve refused; plain controls still work', () => {
    const fns = mount(ctx([VIEW]));
    expect(screen.getByRole('status').textContent).toMatch(/View only/);
    fireEvent.click(screen.getByText('Save'));
    fireEvent.click(screen.getByLabelText("Approve Ravi's correction"));
    fireEvent.click(screen.getByText('Filter'));
    expect(fns.onSave).not.toHaveBeenCalled();
    expect(fns.onApprove).not.toHaveBeenCalled();
    expect(fns.onOther).toHaveBeenCalledTimes(1);
    expect(notify.error).toHaveBeenCalled();
  });

  it('may edit but not approve: Save works, Approve and Reject are refused with the permission they need', () => {
    const fns = mount(ctx([VIEW, 'ATTENDANCE::Attendance Requests::EDIT']));
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByText('Save'));
    expect(fns.onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Approve Ravi's correction"));
    fireEvent.click(screen.getByText('Reject'));
    expect(fns.onApprove).not.toHaveBeenCalled();
    expect(notify.error.mock.calls.map((c) => c[0]).join(' ')).toMatch(/Attendance Requests.*Approve[\s\S]*Payroll Runs.*Approve/i);
  });

  it('approver, administrator, or unknown permissions: nothing is blocked', () => {
    let fns = mount(ctx([VIEW, 'ATTENDANCE::Attendance Requests::APPROVE', 'PAYROLL::Payroll Runs::APPROVE']));
    fireEvent.click(screen.getByLabelText("Approve Ravi's correction"));
    fireEvent.click(screen.getByText('Reject'));
    expect(fns.onApprove).toHaveBeenCalledTimes(2);
    cleanup();
    fns = mount(ctx([VIEW], { isAdmin: true }));
    fireEvent.click(screen.getByText('Save'));
    expect(fns.onSave).toHaveBeenCalledTimes(1);
    cleanup();
    fns = mount(ctx([], { loading: false, error: 'offline' }));
    fireEvent.click(screen.getByText('Save'));
    fireEvent.click(screen.getByLabelText("Approve Ravi's correction"));
    expect(fns.onSave).toHaveBeenCalledTimes(1);
    expect(fns.onApprove).toHaveBeenCalledTimes(1);
  });
});
