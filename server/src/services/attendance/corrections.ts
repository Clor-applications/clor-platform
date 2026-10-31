
/**
 * Attendance corrections: the reasons a correction may give, and what approving or rejecting one does to the day. Moved out of routes/attendance.ts so the portal and insights routes share a service, not a route; behaviour unchanged.
 */

/** Categories for a correction's reason; the free-text reason stays required. */
export const REASON_CODES = ['FORGOT_PUNCH', 'READER_DOWN', 'ON_DUTY', 'WRONG_SHIFT', 'OTHER'] as const;
