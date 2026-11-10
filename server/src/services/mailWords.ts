/**
 * Why a message did not go, in words the CLOR team can act on without
 * reading a mail server's error. The raw error stays on the outbox row.
 */
export function plainMailFailure(lastError: string | null | undefined, status?: string): string | null {
  if (status === 'SUPPRESSED') {
    const e = String(lastError || '');
    if (/sample company/i.test(e)) return 'Not sent: it was for the sample company, which sends nothing.';
    if (/archived/i.test(e)) return 'Not sent: the company is archived.';
    if (/switched off/i.test(e)) return 'Not sent: the company switched this email off.';
    return 'Not sent on purpose.';
  }
  if (!lastError) return null;
  const e = String(lastError);
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(e)) return 'Could not reach the mail server. Engineering should check the mail settings.';
  if (/ETIMEDOUT|timeout|timed out/i.test(e)) return 'The mail server did not answer in time. Try again in a few minutes.';
  if (/EAUTH|535|authentication|invalid login|username and password/i.test(e)) return 'The mail server refused CLOR’s sign-in. Engineering should check the mail password.';
  if (/domain.*not verified|not verified|sender.*not allowed|553|from address/i.test(e)) return 'The sender address is not allowed on the mail server. Check Email, Addresses, or verify the domain.';
  if (/550|5\.1\.1|user unknown|no such user|does not exist|mailbox unavailable|recipient.*rejected/i.test(e)) return 'The receiving server says this address does not exist. Check the spelling with the customer.';
  if (/552|mailbox full|quota|over quota/i.test(e)) return 'The recipient’s mailbox is full.';
  if (/spam|blocked|blacklist|554|policy/i.test(e)) return 'The receiving server blocked it as possible spam.';
  if (/429|rate|too many/i.test(e)) return 'Too many emails at once; the mail server asked us to slow down. Try again shortly.';
  if (/attachment|too large|size/i.test(e)) return 'The message was too large to send.';
  return 'The mail server would not take it. The technical reason is kept for engineering.';
}
