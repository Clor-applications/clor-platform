/**
 * The spreadsheets People and Attendance take in, column by column: the one
 * list the import templates are made from.
 *
 * Each `key` is the heading the importer reads (routes/people.ts `importRow`,
 * routes/attendance.ts, routes/leave.ts, routes/personnel.ts), so a template
 * downloaded from here goes straight back in. `importTemplates.test.ts` posts
 * every template's example row to its importer and blanks each required
 * column in turn; the web tests hold the import screens to the same keys.
 *
 * Plain data and no imports, so those web tests can read this file as it is.
 * CSV, not Excel: the server has no workbook writer yet. The column notes go
 * in rows that start with `#`, which the import screens skip.
 */

export type ImportTemplateColumn = {
  /** The heading in the file, exactly as the importer reads it. */
  key: string;
  /** What people call it. */
  label: string;
  required?: boolean;
  /** What goes in the column and the values it takes. */
  help: string;
  /** The example row's cell; blank where the example leaves it out. */
  example: string;
};

export type ImportTemplate = {
  kind: string;
  /** What the file holds, as the import screens name it. */
  label: string;
  /** One line under the title: what importing it does. */
  about: string;
  /** Which importer takes the rows (path under /api/orgs/:orgId). */
  importer: string;
  columns: ImportTemplateColumn[];
};

const DATE = 'A date, as 15/10/2026 or 2026-10-15.';
const CODE = 'The employee ID exactly as it is on the person’s record.';

export const IMPORT_TEMPLATES: ImportTemplate[] = [
  {
    kind: 'employees',
    label: 'Employees',
    about: 'One row per person. A department, designation or employment type not in CLOR yet is added.',
    importer: '/people/employees/import',
    columns: [
      { key: 'name', label: 'Name', required: true, help: 'The person’s full name.', example: 'Asha Rao' },
      { key: 'code', label: 'Employee ID', help: 'Your own number for the person. Each one is used once. With "Update that employee" chosen, a row whose ID is already in CLOR changes that person.', example: 'E-001' },
      { key: 'email', label: 'Personal email', help: 'An email address.', example: '' },
      { key: 'workEmail', label: 'Work email', help: 'An email address.', example: 'asha@example.com' },
      { key: 'phone', label: 'Phone', help: 'Digits, 7 to 15 of them. A leading + and spaces are fine.', example: '9845012345' },
      { key: 'department', label: 'Department', help: 'The department’s name.', example: 'Finance' },
      { key: 'jobPosition', label: 'Designation', help: 'The designation’s name.', example: 'Accountant' },
      { key: 'employeeType', label: 'Employment type', help: 'For example Permanent, Contract or Intern.', example: 'Permanent' },
      { key: 'workType', label: 'Work mode', help: 'For example Office, Remote or Hybrid.', example: '' },
      { key: 'dateOfJoining', label: 'Joining date', help: DATE, example: '2026-04-01' },
      { key: 'dateOfBirth', label: 'Date of birth', help: DATE, example: '1994-08-17' },
      { key: 'gender', label: 'Gender', help: 'Male, Female, Non-binary, Other or Prefer not to say.', example: 'Female' },
      { key: 'businessUnit', label: 'Business unit', help: 'The business unit’s name.', example: '' },
      { key: 'grade', label: 'Grade', help: 'The grade’s name.', example: '' },
      { key: 'costCentre', label: 'Cost centre', help: 'The cost centre’s name.', example: '' },
      { key: 'hours', label: 'Hours', help: 'Full-time or Part-time. Blank means full-time.', example: 'Full-time' },
      { key: 'probationEndDate', label: 'Probation ends', help: DATE, example: '' },
      { key: 'contractEndDate', label: 'Contract ends', help: DATE, example: '' },
      { key: 'managerCode', label: 'Manager (employee ID)', help: 'The manager’s employee ID. The manager is already in CLOR, or on a row above this one.', example: '' },
      { key: 'workSite', label: 'Work site', help: 'The name of a work site already in CLOR.', example: '' },
    ],
  },
  {
    kind: 'records',
    label: 'Attendance days',
    about: 'One row per person per day: in and out times, or a status.',
    importer: '/attendance/records/import',
    columns: [
      { key: 'employeeCode', label: 'Employee code', required: true, help: CODE, example: 'E-001' },
      { key: 'date', label: 'Date', required: true, help: `${DATE} Not a day still to come.`, example: '2026-10-01' },
      { key: 'checkIn', label: 'In', help: 'The time in, as 09:05 or 9:05 am.', example: '09:05' },
      { key: 'checkOut', label: 'Out', help: 'The time out, as 18:10 or 6:10 pm. Needs a time in.', example: '18:10' },
      { key: 'status', label: 'Status', help: 'Blank when there are times. Otherwise P, A, HD or Leave (PRESENT, ABSENT, HALF_DAY, ON_LEAVE).', example: '' },
      { key: 'note', label: 'Note', help: 'Anything to keep with the day.', example: '' },
    ],
  },
  {
    kind: 'holidays',
    label: 'Holidays',
    about: 'The year’s holidays. A date already on the list with the same name is skipped.',
    importer: '/attendance/holidays/import',
    columns: [
      { key: 'date', label: 'Date', required: true, help: DATE, example: '2026-10-02' },
      { key: 'name', label: 'Name', required: true, help: 'What the holiday is called.', example: 'Gandhi Jayanti' },
      { key: 'optional', label: 'Optional', help: 'yes or no. Blank means no.', example: 'no' },
      { key: 'area', label: 'Area', help: 'The name of a location already in CLOR. Blank means everyone.', example: '' },
    ],
  },
  {
    kind: 'assignments',
    label: 'Shift assignments',
    about: 'Who works which shift, and from when.',
    importer: '/attendance/shift-assignments/import',
    columns: [
      { key: 'employeeCode', label: 'Employee code', required: true, help: CODE, example: 'E-001' },
      { key: 'shift', label: 'Shift name', required: true, help: 'The shift’s name exactly as it is under Shifts.', example: 'General' },
      { key: 'from', label: 'From', required: true, help: DATE, example: '2026-10-01' },
      { key: 'to', label: 'To', help: `${DATE} Blank means until it is changed.`, example: '' },
    ],
  },
  {
    kind: 'leaveBalances',
    label: 'Leave balances',
    about: 'Each person’s days for the year, for each paid leave type. It replaces the leave type’s own days for that person.',
    importer: '/attendance/leave/allocations/import',
    columns: [
      { key: 'employeeCode', label: 'Employee code', required: true, help: CODE, example: 'E-001' },
      { key: 'leaveType', label: 'Leave type', required: true, help: 'The name of a paid leave type exactly as it is under Leave policy.', example: 'Casual' },
      { key: 'year', label: 'Year', help: 'A four-digit year. Blank means this year.', example: '2026' },
      { key: 'days', label: 'Days for the year', help: 'A number from 0 to 366. A blank cell is read as 0 days.', example: '12' },
      { key: 'note', label: 'Note', help: 'Anything to keep with the balance.', example: 'Carried from the old system' },
    ],
  },
  {
    kind: 'leaveHistory',
    label: 'Leave already taken',
    about: 'Past leave. Each row is saved as approved, its days are marked on leave, and the balance counts it.',
    importer: '/attendance/leave/requests/import',
    columns: [
      { key: 'employeeCode', label: 'Employee code', required: true, help: CODE, example: 'E-001' },
      { key: 'leaveType', label: 'Leave type', required: true, help: 'The leave type’s name exactly as it is under Leave policy.', example: 'Casual' },
      { key: 'from', label: 'From', required: true, help: DATE, example: '2026-09-15' },
      { key: 'to', label: 'To', help: `${DATE} Blank means one day.`, example: '2026-09-16' },
      { key: 'halfDay', label: 'Half day', help: 'FIRST or SECOND for a half day (one day only). Blank for whole days.', example: '' },
      { key: 'reason', label: 'Reason', help: 'Why the leave was taken.', example: 'Family function' },
    ],
  },
  {
    kind: 'contractors',
    label: 'Contractors',
    about: 'Labour contractors and their licences. A name already on the list is updated.',
    importer: '/people/contractors/import',
    columns: [
      { key: 'name', label: 'Contractor name', required: true, help: 'The contractor’s name.', example: 'Sri Ganesh Labour Services' },
      { key: 'code', label: 'Code', help: 'Your own short code for the contractor.', example: 'C-01' },
      { key: 'contactPerson', label: 'Contact person', help: 'Who to speak to.', example: 'Ramesh' },
      { key: 'phone', label: 'Phone', help: 'A phone number.', example: '9800000000' },
      { key: 'email', label: 'Email', help: 'An email address.', example: '' },
      { key: 'gstin', label: 'GSTIN', help: 'The 15-character GST number.', example: '' },
      { key: 'licenceNo', label: 'Licence number', help: 'The labour licence number.', example: 'CLRA/123/2026' },
      { key: 'licenceValidTo', label: 'Licence valid to', help: DATE, example: '2027-03-31' },
      { key: 'address', label: 'Address', help: 'The contractor’s address.', example: '' },
    ],
  },
];

export const importTemplate = (kind: string): ImportTemplate | null => IMPORT_TEMPLATES.find((t) => t.kind === kind) || null;

/** The example row, keyed by heading: what the importer is sent for it. */
export const exampleRow = (t: ImportTemplate): Record<string, string> => Object.fromEntries(t.columns.map((c) => [c.key, c.example]));

const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The file's name, without a path character in it. */
export const templateFileName = (t: ImportTemplate) => `CLOR ${t.label.toLowerCase()} import template.csv`;

/**
 * The template as a CSV file: the notes (one `#` row per column), then the
 * heading row, then one example row. A byte-order mark keeps Excel reading
 * it as UTF-8.
 */
export function templateCsv(t: ImportTemplate): string {
  const notes = [
    `# CLOR import template: ${t.label}`,
    `# ${t.about}`,
    '# Type your rows under the heading row and replace the example row. Do not rename the headings. Rows that start with # are ignored.',
    ...t.columns.map((c) => `# ${c.key} = ${c.label}${c.required ? ' (needed)' : ''}. ${c.help}`),
  ];
  const lines = [
    ...notes.map(cell),
    t.columns.map((c) => cell(c.key)).join(','),
    t.columns.map((c) => cell(c.example)).join(','),
  ];
  return `﻿${lines.join('\r\n')}\r\n`;
}
