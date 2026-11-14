import { prisma } from '../utils/prisma.js';

export type ApprovalPolicy = {
  allowSelfApproval: boolean;
  requireApprovalRemarks: boolean;
};

export const defaultApprovalPolicy: ApprovalPolicy = {
  allowSelfApproval: false,
  requireApprovalRemarks: false,
};

export async function getApprovalPolicy(accountId: string, orgId: string): Promise<ApprovalPolicy> {
  const row = await prisma.orgMaster.findFirst({ where: {
    accountId, orgId, kind: 'APPROVAL_POLICY', name: 'Organization',
  }, select: { dataJson: true } });
  if (!row) return { ...defaultApprovalPolicy };
  try {
    const saved = JSON.parse(row.dataJson || '{}');
    return {
      allowSelfApproval: saved?.allowSelfApproval === true,
      requireApprovalRemarks: saved?.requireApprovalRemarks === true,
    };
  } catch { return { ...defaultApprovalPolicy }; }
}
