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
