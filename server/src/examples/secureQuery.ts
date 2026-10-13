import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';

// Example: secure query filtered by userId + accountId + orgId + branchId
//
// Notes:
// - userId is used for authorization (membership/role checks)
// - accountId/orgId/branchId are used for isolation in every query
// - allowedBranchIds comes from membership (UserBranchMembership)

export async function listBranchItemsForUser(input: {
  userId: string;
  accountId: string;
  orgId: string;
  branchId: string;
}) {
  const { userId, accountId, orgId, branchId } = input;

  // 1) Authorization guard: user must be assigned to the org/branch
  const membership = await platformPrisma.userBranchMembership.findFirst({
    where: { accountId, orgId, branchId, userId },
    select: { id: true },
  });
  if (!membership) throw new Error('Forbidden');

  // 2) Isolation query: accountId + orgId + branchId
  // This guarantees no cross-tenant or cross-org leakage.
  return prisma.item.findMany({
    where: { accountId, orgId, OR: [{ branchId: branchId }, { branchId: null }] },
    orderBy: [{ name: 'asc' }],
  });
}
