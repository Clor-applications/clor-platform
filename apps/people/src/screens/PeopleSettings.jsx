import React from 'react';

import SettingsHub from '@ui/settings/SettingsHub';

/* People → Settings: the company, its people's classifications, time off, access, integrations and data. */
const GROUPS = [
  {
    title: 'Company',
    note: 'Who the employer is and how the company is organised.',
    items: [
      ['modules', 'Switch HR modules on or off, and see which apps the subscription carries'],
      ['companyDetails', 'Legal name, PAN, TAN, address and statutory registrations'],
      ['businessUnits', 'Divisions or domains the company runs as one business'],
      ['areas', 'Offices, plants and sites people work at'],
      ['departments', 'How the company is divided; a department can sit under another'],
      ['jobPositions', 'The titles people hold'],
      ['grades', 'Levels or pay bands'],
      ['costCentres', 'Where salary cost is booked in the accounts'],
      ['jobRoles', 'Finer roles inside a designation'],
    ],
  },
  {
    title: 'Employees',
    note: 'How people are classified, and what happens when they join or leave.',
    items: [
      ['employeeTypes', 'Permanent, probation, contract, intern'],
      ['workTypes', 'Office, remote, hybrid, field'],
      ['tags', 'Labels to group people any way you like'],
      ['checklists', 'Joining and leaving checklists'],
      ['selfService', 'Who can sign in to the employee app'],
    ],
  },
  {
    title: 'Leave & Holidays',
    note: 'Leave rules and the company calendar; Attendance uses the same ones.',
    items: [
      ['leaveTypes', 'Each kind of leave: days, who it is for, notice, carry forward, pay-out'],
      ['holidays', 'Company and location holidays'],
    ],
  },
  {
    title: 'Access & Security',
    note: 'How people sign in.',
    items: [['sso', 'Sign in with Google or Microsoft for your domain']],
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
