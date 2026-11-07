import { platformPrisma } from '../../utils/platformPrisma.js';

/**
 * Whether a user belongs to this company: the check for anyone named as an
 * owner, lead or assignee. `user.findUnique({ id })` matched a user of any
 * company, so a help desk request could be assigned to (and its subject sent
 * to) an outsider (audit 7 Nov 2026 #23).
 */
export async function isCompanyUser(accountId: string, orgId: string, userId: string) {
  return Boolean(await platformPrisma.userOrgMembership.findFirst({ where: { accountId, orgId, userId }, select: { id: true } }));
}
