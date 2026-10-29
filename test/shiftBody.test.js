// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { shiftBody } from '../apps/attendance/src/components/shiftBody';

/**
 * The policy screens (Weekly Off Policy, Overtime Policy) change one field of a
 * shift, but PUT /shifts/:id fills anything missing with its default. The body
 * they send must carry every other field unchanged.
 */
const night = {
  id: 's1', name: 'Night', startTime: '22:00', endTime: '06:00', breakMinutes: 30, graceMinutes: 15,
  earlyOutGraceMinutes: 5, halfDayMinutes: 200, fullDayMinutes: 420, overtimeAfterMinutes: 450,
  weeklyOffDays: '0,6', offSaturdays: '', code: 'N1', color: '#334155', isActive: false, createdByUserId: 'u', accountId: 'a',
};

describe('shiftBody', () => {
  it('changes only the weekly offs and keeps the rest of the shift', () => {
    const b = shiftBody(night, { weeklyOffDays: '0', offSaturdays: '2,4' });
    expect(b).toEqual({
      name: 'Night', startTime: '22:00', endTime: '06:00', breakMinutes: 30, graceMinutes: 15, earlyOutGraceMinutes: 5,
      halfDayMinutes: 200, fullDayMinutes: 420, overtimeAfterMinutes: 450, checkInBeforeMinutes: null, checkOutAfterMinutes: null, autoPick: false,
      weeklyOffDays: '0', offSaturdays: '2,4', code: 'N1', color: '#334155', isActive: false,
    });
  });
  it('keeps the punch window and "can be picked" when a policy screen saves the shift', () => {
    const b = shiftBody({ ...night, checkInBeforeMinutes: 60, checkOutAfterMinutes: 0, autoPick: true }, { weeklyOffDays: '0' });
    expect([b.checkInBeforeMinutes, b.checkOutAfterMinutes, b.autoPick]).toEqual([60, 0, true]);
  });
  it('a blank overtime start means after the full day (null), and no weekly off stays none', () => {
    expect(shiftBody(night, { overtimeAfterMinutes: '' }).overtimeAfterMinutes).toBeNull();
    expect(shiftBody(night, { overtimeAfterMinutes: '540' }).overtimeAfterMinutes).toBe(540);
    expect(shiftBody({ ...night, weeklyOffDays: '' }).weeklyOffDays).toBe('');
  });
});
