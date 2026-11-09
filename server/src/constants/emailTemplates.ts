/**
 * Email templates and the notification events that use them.
 *
 * Bodies are plain text with `{{merge}}` fields. Plain text first, deliberately:
 * it always renders, it never lands in a spam filter for being image-heavy, and
 * an HTML variant can be layered on later without changing the send path.
 */

export type TemplateDef = {
  key: string;
  label: string;
  description: string;
  subject: string;
  body: string;
  /** Merge fields available, for the settings screen to document. */
  fields: string[];
  /** Transactional mail is always sent; it cannot be switched off. */
  transactional?: boolean;
};

export const EMAIL_TEMPLATES: TemplateDef[] = [
  {
    key: 'reports.scheduled',
    label: 'Scheduled report',
    description: 'A report somebody asked to receive by e-mail on a schedule (Attendance → Reports).',
    subject: '{{reportTitle}} — {{period}}',
    body: `{{reportTitle}} for {{period}} from {{companyName}}.
{{summary}}
The full table is in this message; open {{appUrl}} for the report with filters and export.
To stop these, ask whoever set the schedule up under Attendance → Reports → Scheduled.`,
    fields: ['reportTitle', 'period', 'companyName', 'summary', 'appName', 'appUrl'],
  },
  {
    key: 'auth.verify_email',
    label: 'Verify your email',
    description: 'Sent when someone signs up, and when they ask for a new link.',
    subject: 'Confirm your email address',
    body: `Hello {{userName}},

Confirm this address to finish setting up your {{appName}} account:

{{verifyUrl}}

The link is valid for 24 hours. If you did not create an account, ignore this message.`,
    fields: ['userName', 'appName', 'verifyUrl', 'email'],
    transactional: true,
  },
  {
    key: 'auth.password_reset',
    label: 'Password reset',
    description: 'Sent when a password reset is requested.',
    subject: 'Reset your password',
    body: `Hello {{userName}},

Use this link to set a new password:

{{resetUrl}}

The link is valid for 30 minutes and can be used once. If you did not ask for this, you can ignore it — your password has not changed.`,
    fields: ['userName', 'appName', 'resetUrl'],
    transactional: true,
  },
  {
    key: 'auth.user_invited',
    label: 'User invited',
    description: 'Sent when an administrator creates a user.',
    subject: 'You have been added to {{orgName}}',
    body: `Hello {{userName}},

{{inviterName}} has added you to {{orgName}} on {{appName}}.

Sign in here: {{appUrl}}
Your username is {{email}}.

You will be asked to set your own password on first sign-in.`,
    fields: ['userName', 'orgName', 'inviterName', 'appName', 'appUrl', 'email'],
    transactional: true,
  },
  {
    key: 'account.invited',
    label: 'Invitation to an account',
    description: 'Sent when an owner or administrator invites someone into the account (Workspace → Invitations).',
    subject: '{{inviterName}} invited you to {{accountName}} on {{appName}}',
    body: `Hello,

{{inviterName}} invited you to join {{accountName}} on {{appName}}{{companies}}.

Accept the invitation here:

{{inviteUrl}}

The link works once and expires on {{expiresOn}}. If you were not expecting this, you can ignore it.`,
    fields: ['inviterName', 'accountName', 'appName', 'inviteUrl', 'expiresOn', 'companies'],
    transactional: true,
  },
  {
    key: 'account.welcome',
    label: 'Your account is ready',
    description: 'Sent to a new owner when the CLOR team creates their account (after a demo). Carries the link to set a password.',
    subject: 'Your {{appName}} account for {{companyName}} is ready',
    body: `Hello {{userName}},

Your {{appName}} account for {{companyName}} is ready, with {{apps}}.{{trialNote}}

Set your password here, then sign in with {{email}}:

{{setPasswordUrl}}

The link works once and for {{days}} days. If it has run out, use "Forgot password" on the sign-in page.`,
    fields: ['userName', 'companyName', 'apps', 'trialNote', 'setPasswordUrl', 'email', 'days', 'appName'],
    transactional: true,
  },
  {
    key: 'signup.confirm',
    label: 'Confirm your email to start your trial',
    description: 'Sent when somebody starts a free trial from clor.in: the link that checks their email and opens the setup page.',
    subject: 'Your {{appName}} trial: confirm your email',
    body: `Hello,

You asked to start a free trial of {{apps}} on CLOR. Confirm this is your email and set up your company here:

{{startUrl}}

The link works for {{hours}} hours. No card is needed; the trial runs for {{days}} days.

If you did not ask for this, ignore this mail and nothing is made.`,
    fields: ['apps', 'startUrl', 'hours', 'days', 'appName'],
    transactional: true,
  },
  {
    key: 'explore.pass',
    label: 'Look around CLOR',
    description: 'Sent to somebody who asked for a demo on clor.in: a 14-day link to a sample company they can look around, read-only.',
    subject: 'Look around {{appName}} while we set up your demo',
    body: `Hello {{name}},

Thank you for asking for a demo of {{apps}}. We will call you to fix a time.

Until then, you can look around now. This link opens Sample Traders Pvt Ltd, a made-up company with a few months of invoices, pay runs, people and attendance in it. Open any screen you like; nothing you change is saved.

{{exploreUrl}}

The link works for {{days}} days, until {{expiresOn}}. Anyone with it sees the same sample company, and nothing of yours.`,
    fields: ['name', 'apps', 'exploreUrl', 'days', 'expiresOn', 'appName'],
    transactional: true,
  },
  {
    key: 'sales.demo_requested',
    label: 'Demo requested',
    description: 'Sent to the CLOR sales inbox when somebody asks for a demo on clor.in.',
    subject: 'Demo request: {{company}} ({{apps}})',
    body: `{{name}} from {{company}} asked for a demo.

Apps: {{apps}}
Company size: {{companySize}} employees
People who will sign in: {{users}}
City: {{city}}
Email: {{email}}
Phone: {{phone}}

{{message}}

Open it in the operator console: {{opsUrl}}`,
    fields: ['name', 'company', 'apps', 'companySize', 'users', 'city', 'email', 'phone', 'message', 'opsUrl'],
    transactional: true,
  },
  {
    key: 'approval.requested',
    label: 'Approval requested',
    description: 'Sent to holders of the approving role when a document exceeds a threshold.',
    subject: '{{docType}} {{docNumber}} needs your approval',
    body: `{{requesterName}} raised {{docType}} {{docNumber}} for {{amount}}, which is above the limit set by the rule "{{ruleName}}".

It will not post to the books until it is approved.

Review it here: {{appUrl}}`,
    fields: ['docType', 'docNumber', 'amount', 'ruleName', 'requesterName', 'appUrl', 'orgName'],
  },
  {
    key: 'approval.decided',
    label: 'Approval decided',
    description: 'Sent to whoever raised the document once it is approved or rejected.',
    subject: '{{docType}} {{docNumber}} was {{decision}}',
    body: `{{deciderName}} {{decision}} {{docType}} {{docNumber}} for {{amount}}.

{{comment}}

{{appUrl}}`,
    fields: ['docType', 'docNumber', 'amount', 'decision', 'deciderName', 'comment', 'appUrl'],
  },
  {
    key: 'invoice.sent',
    label: 'Invoice to customer',
    description: 'Sends an invoice to the customer on request.',
    subject: 'Invoice {{invoiceNumber}} from {{orgName}}',
    body: `Dear {{customerName}},

Invoice {{invoiceNumber}} dated {{invoiceDate}} for {{amount}} is attached below.

{{dueLine}}

Thank you for your business.
{{orgName}}`,
    fields: ['customerName', 'invoiceNumber', 'invoiceDate', 'amount', 'dueLine', 'orgName'],
  },
  {
    key: 'invoice.payment_reminder',
    label: 'Payment reminder',
    description: 'Reminds a customer about an overdue invoice.',
    subject: 'Reminder: invoice {{invoiceNumber}} is overdue',
    body: `Dear {{customerName}},

Invoice {{invoiceNumber}} for {{amount}} was due on {{dueDate}} and is showing as unpaid.

If you have already paid, please ignore this message.

{{orgName}}`,
    fields: ['customerName', 'invoiceNumber', 'amount', 'dueDate', 'orgName'],
  },
  {
    key: 'payroll.bank_change_requested',
    label: 'Bank details change requested',
    description: 'Sent to an employee when somebody asks to change the bank account their salary is paid into.',
    subject: 'Your salary bank account at {{orgName}} is being changed',
    body: `Hello {{employeeName}},

Somebody at {{orgName}} has asked to change the bank account your salary is paid into, to an account ending {{newAccountEnding}}.

If you asked for this, there is nothing to do: it takes effect once it is approved.

If you did not, tell HR straight away — by phone or in person, not by replying to an e-mail. Your salary keeps going to your current account until the change is approved.`,
    fields: ['employeeName', 'orgName', 'newAccountEnding'],
    transactional: true,
  },
  {
    key: 'attendance.portal_invite',
    label: 'Employee portal activation',
    description: 'Sent when HR gives an employee an activation code for the employee portal.',
    subject: 'Your {{orgName}} employee portal code',
    body: `Hello {{employeeName}},

{{orgName}} has set you up on the employee portal: your attendance, schedule and leave{{phoneLine}}.

Open {{portalUrl}} and choose "First time? Activate", then enter:

  Company code:     {{companyCode}}
  Employee code:    {{employeeCode}}
  Activation code:  {{activationCode}}

and choose your own password. The code works once and runs out on {{expires}}. Nobody at {{orgName}} will ever know your password.`,
    fields: ['employeeName', 'orgName', 'portalUrl', 'companyCode', 'employeeCode', 'activationCode', 'expires', 'phoneLine'],
    transactional: true,
  },
  {
    key: 'people.joined',
    label: 'Somebody joined',
    description: 'Sent to the people who manage employees when a person is added to People.',
    subject: '{{name}} joined {{orgName}}',
    body: `{{name}} ({{code}}) was added to People{{department}} by {{byName}}.
Open People to complete their file: documents, reader ID, salary, shift.`,
    fields: ['name', 'code', 'department', 'byName', 'orgName'],
  },
  {
    key: 'people.left',
    label: 'Somebody left',
    description: 'Sent to the people who manage employees when a person is marked as left.',
    subject: '{{name}} has left {{orgName}}',
    body: `{{name}} ({{code}}) was marked as left by {{byName}}.
Readers have been told; payroll may need a full and final settlement, and their login (if any) can be switched off under Settings → Users.`,
    fields: ['name', 'code', 'byName', 'orgName'],
  },
  {
    key: 'people.document_expiring',
    label: 'Document expiring',
    description: 'Sent to the people who manage employees when an employee document (permit, licence, contract) is 60, 30 or 7 days from expiry, and on the day.',
    subject: '{{title}} for {{name}} expires on {{expiresOn}}',
    body: `{{name}}’s {{kind}} “{{title}}” expires on {{expiresOn}} ({{days}} days).
Open People → the employee → Documents to renew it.`,
    fields: ['name', 'title', 'kind', 'expiresOn', 'days', 'orgName'],
  },
  {
    key: 'attendance.reader_alert',
    label: 'Reader alert',
    description: 'Sent to the people named under Attendance → Reader health when a reader problem starts.',
    subject: '[{{severity}}] {{title}} — {{orgName}}',
    body: `{{title}}

{{details}}

You get one message when a problem starts and one when it clears. Reader health in Attendance shows every reader and what is wrong.`,
    fields: ['orgName', 'title', 'details', 'severity'],
    transactional: true,
  },
  {
    key: 'attendance.reader_alert_cleared',
    label: 'Reader alert cleared',
    description: 'Sent when a reader problem that was alerted has cleared.',
    subject: 'Cleared: {{title}} — {{orgName}}',
    body: `This has cleared after {{openedFor}}: {{title}}`,
    fields: ['orgName', 'title', 'openedFor'],
    transactional: true,
  },
  {
    key: 'people.join_invite',
    label: 'Fill in your details before you join',
    description: 'Sent to someone about to join, with a link that works once and runs out in fourteen days, so they can fill in personal details and upload documents before day one.',
    subject: 'Welcome to {{orgName}} — a few details before {{joiningDate}}',
    body: `Hello {{name}},

Welcome to {{orgName}}. Before you join on {{joiningDate}}, please fill in your personal details, your PAN, PF, ESI and bank details for pay, and add copies of your ID and other documents here:
{{link}}

The link works once and runs out on {{expiresOn}}. You see only your own details; HR checks what you send before it goes on your record.
{{message}}
If you did not expect this, ignore it.`,
    fields: ['name', 'orgName', 'joiningDate', 'link', 'expiresOn', 'message'],
  },
  {
    key: 'people.offer',
    label: 'Offer letter',
    description: 'Sent to a candidate or someone about to join, with their offer letter and a link to accept it that works until the offer runs out.',
    subject: 'Your offer from {{orgName}}: {{designation}}',
    body: `Hello {{name}},

{{orgName}} is pleased to offer you the position of {{designation}}, with a cost to the company (CTC) of {{ctc}} a year.

Read your offer letter and accept it here:
{{link}}

The offer is open until {{acceptBy}}.
{{message}}
If you did not expect this, ignore it.`,
    fields: ['name', 'orgName', 'designation', 'ctc', 'link', 'acceptBy', 'message'],
  },
  {
    key: 'people.interview',
    label: 'Interview set or moved',
    description: 'Sent to a candidate when an interview is set for them, and again when it is moved: the day, the time, how it is held and who they will meet.',
    subject: '{{headline}}: {{orgName}}, {{day}} at {{time}}',
    body: `Hello {{name}},

{{headline}} for the {{jobTitle}} position at {{orgName}}.

When: {{day}} at {{time}} ({{minutes}} minutes)
How: {{mode}}{{placeLine}}
You will meet: {{interviewers}}

If the time does not suit you, reply to this e-mail and we will find another.

{{orgName}}`,
    fields: ['name', 'headline', 'jobTitle', 'orgName', 'day', 'time', 'minutes', 'mode', 'placeLine', 'interviewers'],
  },
  {
    key: 'people.candidate_not_taken',
    label: 'Candidate not taken forward',
    description: 'Sent to a candidate when the company decides not to go ahead with their application. Plain and kind; it gives no reason.',
    subject: 'Your application to {{orgName}}',
    body: `Hello {{name}},

Thank you for applying for the {{jobTitle}} position at {{orgName}}, and for the time you gave us.

We will not be taking your application further this time. We were glad to meet you, and we wish you well in your search.

{{orgName}}`,
    fields: ['name', 'jobTitle', 'orgName'],
  },
  {
    key: 'people.task_assigned',
    label: 'Joining or leaving tasks for you',
    description: 'Sent once to each person given tasks on a joining, leaving or change plan, listing their tasks, each with a link that marks it done.',
    subject: '{{title}} — {{employeeName}}, due {{dueDate}}',
    body: `{{title}}
For: {{employeeName}}{{employeeCode}}
Due: {{dueDate}}
Part of: {{kind}}

When a task is done, open its link and press Mark done (each link is only for you; opening it changes nothing by itself):
{{doneLink}}

Or open People at {{appUrl}}.`,
    fields: ['title', 'employeeName', 'employeeCode', 'dueDate', 'kind', 'doneLink'],
  },
  {
    key: 'people.task_digest',
    label: 'Joining and leaving tasks due',
    description: 'Once a day, to each person with joining, leaving or change tasks due that day or late: one list, never one e-mail per task. HR also hears about tasks three or more days late on someone else\'s name.',
    subject: '{{count}} joining and leaving tasks for you today',
    body: `Due today or late:
{{lines}}
{{others}}
Open People to tick them: {{appUrl}}`,
    fields: ['count', 'lines', 'others'],
  },
  {
    key: 'people.data_breach',
    label: 'Personal data breach notice',
    description: 'Sent to each person a recorded personal-data breach affects (DPDP Rules, rule 7). Cannot be switched off.',
    subject: 'About your personal data at {{orgName}}',
    body: `{{orgName}} is writing to tell you about a personal-data breach that affects you.

What happened: {{description}}
When: {{when}}
Your data involved: {{categories}}
What it may mean for you: {{consequences}}
What we have done: {{mitigation}}
What you can do: {{stepsForPeople}}

Questions: {{contact}}. You can also complain to the Data Protection Board of India.`,
    fields: ['orgName', 'description', 'when', 'categories', 'consequences', 'mitigation', 'stepsForPeople', 'contact'],
    transactional: true,
  },
  {
    key: 'people.weekly_summary',
    label: 'Monday summary',
    description: 'Each Monday, to owners and HR: who is away this week, what waits for a decision, lapsing leave, and who joins or leaves (services/people/weeklySummary.ts).',
    subject: '{{orgName}} this week: {{headline}}',
    body: `Hello {{name}},

{{summary}}

Open it in CLOR: {{appUrl}}/{{link}}

You get this because you look after people at {{orgName}}. Your company can switch this e-mail off in its notification settings, and you can mute it from the bell.`,
    fields: ['name', 'orgName', 'headline', 'summary', 'link', 'appName', 'appUrl'],
  },
  {
    key: 'people.absence_notice',
    label: 'Absence notice',
    description: 'A notice to someone absent with no leave and no word, asking them to report back or explain by a date (People → Absences). The letter is also in their documents in the employee app.',
    subject: '{{orgName}}: please report back or explain your absence by {{reportBy}}',
    body: `{{letter}}

This notice is also in your documents in the {{orgName}} employee app.`,
    fields: ['name', 'orgName', 'letter', 'reportBy', 'appName', 'appUrl'],
    transactional: true,
  },
  {
    key: 'people.automation',
    label: 'Automation reminder',
    description: 'A ready-made automation the company switched on (People → Settings → Automations): the joiner’s first-day plan, the exit interview reminder.',
    subject: '{{orgName}}: {{headline}}',
    body: `Hello {{name}},

{{body}}

Open the {{orgName}} employee app to see it there too.`,
    fields: ['name', 'orgName', 'headline', 'body', 'appName', 'appUrl'],
    transactional: true,
  },
];

export const TEMPLATE_BY_KEY = new Map(EMAIL_TEMPLATES.map((t) => [t.key, t]));

/** Notification events an organisation can switch off (transactional excluded). */
export const NOTIFICATION_EVENTS = EMAIL_TEMPLATES.filter((t) => !t.transactional).map((t) => ({
  key: t.key,
  label: t.label,
  description: t.description,
}));

/** Replaces {{field}} with its value; unknown fields collapse to an empty string. */
export function render(template: string, data: Record<string, unknown>) {
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, key) => {
    const value = data[key];
    return value === undefined || value === null ? '' : String(value);
  });
}
