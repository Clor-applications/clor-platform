/*
 * Round 64 "settingsfind" A: the words people search with that live inside a setting, not in its name or line.
 * "grace" finds Attendance rules and Default shift; "sandwich" finds Leave policy. Settings search lists them as
 * "grace → Time off › Attendance rules" and opens the page.
 */
/* Kept apart from settingsGroups.js, whose [key, line] rows the navigation tests read. */
export const SETTING_WORDS = {
  companyDetails: ['PF establishment code', 'ESIC code', 'PT registration', 'labour welfare fund', 'CIN', 'registered office', 'company address', 'company phone'],
  departments: ['department head', 'sub-department'],
  jobPositions: ['job title', 'title'],
  employeeTypes: ['probation', 'notice period', 'intern', 'contract'],
  leaveTypes: ['sandwich rule', 'carry forward', 'encashment', 'casual leave', 'sick leave', 'earned leave', 'privilege leave', 'maternity', 'half day', 'comp-off', 'credit', 'accrual', 'proof', 'medical certificate', 'leave in advance'],
  holidays: ['festival', 'Diwali', 'national holiday', 'optional holiday', 'restricted holiday'],
  workingWeek: ['weekly off', 'Saturday off', 'second Saturday', 'Sunday'],
  leaveYearEnd: ['lapse', 'carry forward', 'year end', 'encash'],
  attendanceRules: ['grace', 'late mark', 'late coming', 'missing punch', 'half day', 'unexplained absence', 'night work'],
  requestRules: ['work from home', 'WFH', 'on duty', 'missed punch', 'permission hours', 'short leave'],
  shiftPolicy: ['grace', 'late arrival', 'general shift', 'office hours'],
  overtimePolicy: ['OT', 'extra hours', 'comp-off', 'overtime rate'],
  rotations: ['rotating shift', 'night shift', 'roster'],
  sites: ['geofence', 'punch area', 'radius', 'location'],
  approvalRules: ['approver', 'approval chain', 'who approves', 'escalation'],
  standIns: ['delegate', 'on leave approver', 'stand-in'],
  emailNotifications: ['email', 'notice', 'reminder'],
  rolesAccess: ['permission', 'access', 'who can see'],
  dataImport: ['Excel', 'upload', 'import employees'],
  dataExport: ['backup', 'download data'],
  recycleBin: ['deleted', 'restore', 'undo delete'],
  auditLogs: ['who changed', 'history', 'audit trail'],
};
