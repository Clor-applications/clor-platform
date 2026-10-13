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
