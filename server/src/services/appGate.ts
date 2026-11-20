import { appStanding } from './subscriptions.js';

/**
 * Whether an app's routes answer this request (audit, 17 Nov 2026).
 *
 * The People, Payroll and Attendance guards asked "is the app entitled" and refused everything otherwise, so a
 * trial that ran out or a payment overdue took employees' payslips and records away, though the message said
 * everything could still be read. The company side (middleware/rbac.ts) already reads on a lapsed app and refuses
 * changes; this is the same rule for the app-level guards. Any one of `apps` will do.
 *
 * Returns null when the request may go on, or the refusal to send.
 */
export async function appGate(
  accountId: string,
  apps: string[],
  method: string,
  words: { name: string; app: string },
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  let lapsed: string | null = null;
  for (const app of apps) {
    const standing = await appStanding(accountId, app);
    if (standing.state === 'entitled') return null;
    if (standing.state === 'lapsed') lapsed = standing.reason;
  }
  const reading = ['GET', 'HEAD', 'OPTIONS'].includes(String(method || '').toUpperCase());
  if (lapsed && reading) return null;
  if (lapsed) return { status: 402, body: { error: lapsed, app: words.app, code: 'SUBSCRIPTION_LAPSED' } };
  return { status: 402, body: { error: `${words.name} is not on this account’s subscription. An owner can add it under Workspace → Billing.`, app: words.app, code: 'APP_NOT_SUBSCRIBED' } };
}
