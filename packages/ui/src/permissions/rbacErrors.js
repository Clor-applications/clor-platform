/**
 * What a refusal from role or user administration means, in words a person
 * can act on.
 *
 * The server says why with a stable `code`; its `error` sentence is correct
 * but addressed to nobody in particular. This turns the code into the next
 * step. Anything without a known code keeps the server's own words.
 */
const MESSAGES = {
  cannot_grant_unheld: (d) =>
    `You can only hand out permissions you hold yourself${
      Array.isArray(d?.permissions) && d.permissions.length ? ` (not held: ${d.permissions.slice(0, 3).join(', ')}${d.permissions.length > 3 ? '…' : ''})` : ''
    }. Ask an administrator to make this change.`,
  admin_only: () => 'Only an administrator can create, change or hand out an Administrator role. Ask an administrator.',
  last_admin: () =>
    'This would leave the company without an administrator. Make someone else an administrator first, then try again.',
  admin_lockout: () =>
    'An Administrator role must keep the right to manage users and roles, or nobody could undo this. Leave Users and Roles ticked.',
  role_in_use: (d) =>
    d?.approvalRulesCount
      ? `This role approves documents in ${d.approvalRulesCount} approval rule${d.approvalRulesCount === 1 ? '' : 's'}. Change those rules first.`
      : `This role is assigned to ${d?.assignedUsersCount || 'some'} user${d?.assignedUsersCount === 1 ? '' : 's'}. Give them another role first.`,
};

export function rbacErrorMessage(err, fallback = 'Something went wrong') {
  const data = err?.data || {};
  const build = data.code ? MESSAGES[data.code] : null;
  if (build) return build(data);
  return String(err?.message || fallback);
}
