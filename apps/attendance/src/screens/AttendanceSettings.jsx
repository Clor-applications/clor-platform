import React from 'react';

import SettingsHub from '@ui/settings/SettingsHub';

/**
 * Attendance → Settings (founder, 22 Oct 2026): the sidebar keeps the day's
 * work; what is set up once is here, the way People's Settings is. Keys are
 * the nav keys they always were, so old links (?open=holidays) still land.
 */
const GROUPS = [
  {
    title: 'Company',
    note: 'Who the employer is and how the company is organised.',
    items: [
      ['companyDetails', 'Legal name, PAN, TAN, address and statutory registrations'],
      ['businessUnits', 'Divisions or domains the company runs as one business'],
      ['areas', 'Offices, plants and sites people work at'],
      ['departments', 'How the company is divided; a department can sit under another'],
      ['positions', 'The titles people hold'],
      ['grades', 'Levels or pay bands'],
      ['costCentres', 'Where salary cost is booked in the accounts'],
    ],
  },
  {
    title: 'Work Policy',
    note: 'How a day is counted: hours, late marks, weekly offs, overtime, leave and holidays.',
    items: [
      ['setup', 'Step-by-step set-up, and what is still missing'],
      ['rules', 'Grace time, half days, late and early marks, rounding'],
      ['weeklyOffPolicy', 'Which days are off, by shift'],
      ['overtimePolicy', 'When overtime counts, and comp-off'],
      ['leaveTypes', 'Leave types, yearly days, carry forward'],
      ['holidays', 'Company and location holidays'],
    ],
  },
  {
    title: 'Employee App & Sites',
    note: 'Punching from a phone, and where it is allowed.',
    items: [
      ['portalAccess', 'Who can sign in to the employee app, and their activation codes'],
      ['sites', 'Places a phone punch is accepted from'],
      ['siteCheck', 'Try a location against the work sites'],
    ],
  },
  {
    title: 'Integrations',
    note: 'Connect CLOR to your other systems.',
    items: [['integrations', 'Readers’ middleware, webhooks, API keys and HR tool sync']],
    apps: [
      ['people', 'People', 'The full HR record: documents, hiring, performance'],
      ['payroll', 'Payroll', 'Salaries from these payable days'],
    ],
  },
  {
    title: 'Access & Security',
    note: 'How people sign in.',
    items: [['sso', 'Sign in with Google or Microsoft for your domain']],
  },
  {
    title: 'Data',
    note: 'Bring data in, take it out, and keep it right.',
    items: [
      ['dataImport', 'Employees, punches, shifts and more from a spreadsheet'],
      ['dataExport', 'A copy of the company’s attendance data'],
      ['dataHealth', 'Missing or wrong details before they cost a payroll'],
      ['auditLogs', 'Who changed what, and when'],
      ['recycleBin', 'Bring back what was deleted in the last 30 days'],
      ['closeCompany', 'Stop using CLOR and have the company’s data removed'],
    ],
  },
  {
    title: 'Compliance & Privacy',
    note: 'Deadlines, and what the law asks about personal data.',
    items: [
      ['complianceCalendar', 'Statutory and company deadlines with owners'],
      ['dataProtection', 'Privacy notice and consent (DPDP)'],
      ['dataRequests', 'Employees’ requests to see, correct or erase data'],
    ],
  },
];

export default function AttendanceSettings(props) {
  return <SettingsHub {...props} groups={GROUPS} />;
}
