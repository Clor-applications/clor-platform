import React from 'react';

import SettingsHub from '@ui/settings/SettingsHub';

/* People → Settings in eight groups of plain rows (People plan, 8 Nov 2026): company, people, joining and leaving, requests, time, access, apps, data. */
const GROUPS = [
  {
    title: 'Company',
    note: 'Who the employer is. How the company is organised is under Organization.',
    items: [
      ['modules', 'Simple mode, HR modules on or off, and which apps the subscription carries'],
      ['companyDetails', 'Legal name, PAN, TAN, address and statutory registrations'],
      ['legalEntities', 'Only when one group runs more than one registered company: which one each work site belongs to'],
    ],
  },
  {
    title: 'People',
    note: 'How people are classified and what is kept about them.',
    items: [
      ['employeeTypes', 'Permanent, fixed-term, trainee, intern, consultant: what each counts as, probation and notice'],
      ['workTypes', 'Office, remote, hybrid, field'],
      ['tags', 'Labels to group people any way you like'],
      ['customFields', 'Your own fields on every person: who sees them, who edits them'],
    ],
  },
  {
    title: 'Joining & leaving',
    note: 'What happens when someone joins or leaves, and the letters and reminders that go with it.',
    items: [
      ['journeySteps', 'The steps when someone joins or leaves: whose, when, for whom, and which need a note'],
      ['exitQuestions', 'The questions a leaver answers in the employee app, and how long answers are kept'],
      ['letterTemplates', 'Offer, appointment, relieving and other letters the company issues'],
      ['automations', 'Reminders CLOR sends on its own: probation ending, final pay due, birthdays, leave waiting'],
    ],
  },
  {
    title: 'Requests & approvals',
    note: 'What people may ask for, who decides, and what they may change themselves.',
    items: [
      ['approvalRules', 'Who decides job changes, resignations, probation, policies: steps, due days, overdue'],
      ['companyChoices', 'Who decides attendance requests, withdrawn notices, who sees salary revisions and why someone leaves'],
      ['requestForms', 'Requests people can make, such as an ID card or a salary certificate: the form, who may ask, who approves'],
      ['helpDeskSettings', 'Help desk categories, reply and resolve times, and answer templates'],
      ['selfService', 'Who can sign in to the employee app'],
      ['selfServiceChanges', 'Which of their own details employees may change without waiting for HR'],
    ],
  },
  {
    title: 'Time',
    note: 'Leave rules and the company calendar; Attendance uses the same ones.',
    items: [
      ['leaveTypes', 'The leave period, and each kind of leave: credits and their dates, who it is for, notice, carry forward, pay-out'],
      ['holidays', 'Company and location holidays'],
      ['leaveBlocks', 'Days nobody may ask for leave, such as the year-end close; for some departments or leave types'],
      ['workingWeek', 'Which days of the week are off, for everyone not on a shift'],
      ['requestRules', 'Work from home, on duty, missed punch and permission hours: what is on, monthly limits, who approves'],
      ['attendanceRules', 'Late marks that cost part of a day, missing-punch reminders, unexplained absence and night work for women'],
      ['leaveYearEnd', 'What carries, lapses or is paid out when the leave period ends'],
    ],
  },
  {
    title: 'Access & security',
    note: 'How people sign in.',
    items: [
      ['sso', 'Users, sign-in and single sign-on, in Workspace'],
      ['rolesAccess', 'What each role may do in People, in Workspace'],
    ],
  },
  {
    title: 'Apps & integrations',
    note: 'The other CLOR apps that work from these people, and your other systems.',
    items: [['integrations', 'Webhooks, API keys and HR tool sync']],
    apps: [
      ['payroll', 'Payroll', 'Salaries, statutory deductions and payslips for these people'],
      ['attendance', 'Attendance', 'Readers, shifts and days for these people'],
    ],
  },
  {
    title: 'Data & privacy',
    note: 'Bring data in, take it out, and keep it right.',
    items: [
      ['dataImport', 'Employees, leave balances and more from a spreadsheet'],
      ['dataExport', 'A copy of the company’s HR data'],
      ['dataHealth', 'Missing or wrong details before they cost a payroll'],
      ['privacy', 'Who opened sensitive details, how long records are kept, and auditor access'],
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
