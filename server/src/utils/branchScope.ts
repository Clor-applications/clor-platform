import { prisma } from './prisma.js';
import { platformPrisma } from './platformPrisma.js';

// When a branch chooses "Share ledgers and settings of head office":
// - masters can be resolved from (current branch) OR (parent/head-office branch) OR (org-shared null)
// - transactions must always use the active branchId (never inherited)

export async function getEffectiveMasterBranchIds(input: {
  accountId: string;
  orgId: string;
  branchId: string;
}): Promise<string[]> {
  const { accountId, orgId, branchId } = input;

  const branch = await platformPrisma.branch.findFirst({
    where: { accountId, orgId, id: branchId },
    select: { id: true, parentBranchId: true, shareHeadOfficeSettings: true },
  });

  if (!branch) return [branchId];

  const ids = new Set<string>();
  ids.add(branch.id);

  if (branch.shareHeadOfficeSettings && branch.parentBranchId) {
    ids.add(branch.parentBranchId);
  }

  return [...ids];
}
