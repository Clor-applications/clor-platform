import React from 'react';

import SettingsHub from '@ui/settings/SettingsHub';

/* People → Settings: the company, its people's classifications, time off, access, integrations and data. */
const GROUPS = [
  {
    title: 'Company',
    note: 'Who the employer is. How the company is organised is under Organization.',
    items: [
      ['modules', 'Simple mode, HR modules on or off, and which apps the subscription carries'],
      ['companyDetails', 'Legal name, PAN, TAN, address and statutory registrations'],
      ['legalEntities', 'The registered company its work sites belong to'],
    ],
  },
  {
    title: 'Employees',
    note: 'How people are classified, and what happens when they join or leave.',
    items: [
      ['employeeTypes', 'Permanent, fixed-term, trainee, intern, consultant: what each counts as, probation and notice'],
      ['workTypes', 'Office, remote, hybrid, field'],
      ['tags', 'Labels to group people any way you like'],
      ['customFields', 'Your own fields on every person: who sees them, who edits them'],
      ['checklists', 'Joining and leaving checklists'],
      ['letterTemplates', 'Offer, appointment, relieving and other letters the company issues'],
      ['helpDeskSettings', 'Help desk categories, reply and resolve times, and answer templates'],
      ['approvalRules', 'Who decides job changes, resignations, probation, policies: steps, due days, overdue'],
      ['selfService', 'Who can sign in to the employee app'],
      ['selfServiceChanges', 'Which of their own details employees may change without waiting for HR'],
    ],
  },
  {
    title: 'Time & Leave',
    note: 'Leave rules and the company calendar; Attendance uses the same ones.',
    items: [
      ['leaveTypes', 'The leave period, and each kind of leave: credits and their dates, who it is for, notice, carry forward, pay-out'],
      ['holidays', 'Company and location holidays'],
      ['workingWeek', 'Which days of the week are off, for everyone not on a shift'],
      ['requestRules', 'Work from home, on duty, missed punch and permission hours: what is on, monthly limits, who approves'],
      ['leaveYearEnd', 'What carries, lapses or is paid out when the leave period ends'],
    ],
  },
  {
    title: 'Access & Security',
    note: 'How people sign in.',
    items: [
      ['sso', 'Users, sign-in and single sign-on, in Workspace'],
      ['rolesAccess', 'What each role may do in People, in Workspace'],
    ],
  },
  {
    title: 'Integrations',
    note: 'Connect CLOR to your other systems.',
    items: [['integrations', 'Webhooks, API keys and HR tool sync']],
    apps: [
      ['payroll', 'Payroll', 'Salaries, statutory deductions and payslips for these people'],
      ['attendance', 'Attendance', 'Readers, shifts and days for these people'],
    ],
  },
  {
    title: 'Data & Privacy',
    note: 'Bring data in, take it out, and keep it right.',
    items: [
      ['dataImport', 'Employees, leave balances and more from a spreadsheet'],
      ['dataExport', 'A copy of the company’s HR data'],
      ['dataHealth', 'Missing or wrong details before they cost a payroll'],
      ['auditLogs', 'Who changed what, and when'],
      ['recycleBin', 'Bring back what was deleted in the last 30 days'],
      ['dataProtection', 'Privacy notice and consent (DPDP)'],
      ['dataRequests', 'Employees’ requests to see, correct or erase data'],
    ],
  },
];

export default function PeopleSettings(props) {
  return <SettingsHub {...props} groups={GROUPS} />;
}
