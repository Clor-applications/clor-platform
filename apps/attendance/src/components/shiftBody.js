/**
 * A shift as the API's PUT /shifts/:id expects it: every field, because the
 * server fills anything missing with its default. The policy screens change
 * one or two fields of a shift (its weekly offs, when overtime starts) and
 * must send the rest exactly as they are, or a save there would quietly reset
 * the shift's grace, break or hours.
 */
export const shiftBody = (s, patch = {}) => {
  const v = { ...s, ...patch };
  return {
    name: v.name,
    startTime: v.startTime,
    endTime: v.endTime,
    breakMinutes: Number(v.breakMinutes),
    graceMinutes: Number(v.graceMinutes),
    earlyOutGraceMinutes: Number(v.earlyOutGraceMinutes),
    halfDayMinutes: Number(v.halfDayMinutes),
    fullDayMinutes: Number(v.fullDayMinutes),
    overtimeAfterMinutes: v.overtimeAfterMinutes === '' || v.overtimeAfterMinutes == null ? null : Number(v.overtimeAfterMinutes),
    weeklyOffDays: v.weeklyOffDays ?? '',
    offSaturdays: v.offSaturdays || '',
    code: v.code || null,
    color: v.color || null,
    isActive: v.isActive !== false,
  };
};
