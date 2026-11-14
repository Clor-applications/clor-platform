import { Prisma } from '@prisma/client';
import { platformPrisma } from '../utils/platformPrisma.js';

export type PartyKind = 'CUSTOMER' | 'VENDOR';

export const codeFormatFor = (profileJson: string | null, kind: PartyKind) => {
  let saved: Record<string, any> = {};
  try { saved = JSON.parse(profileJson || '{}')?.partyCodeSettings?.[kind === 'VENDOR' ? 'vendor' : 'customer'] || {}; }
  catch { /* use defaults */ }
  return { prefix: kind === 'VENDOR' ? 'VEND' : 'CUST', suffix: '', separator: '-', digits: 5, nextNumber: 1, mode: 'automatic', includeBranchCode: false, includeYear: false, componentOrder: ['prefix', 'branch', 'year', 'sequence', 'suffix'], ...saved };
};

export const renderPartyCode = (format: ReturnType<typeof codeFormatFor>, sequence: bigint, branchCode = '', date = new Date()) => {
  const standard = ['prefix', 'branch', 'year', 'sequence', 'suffix'];
  const order = Array.isArray(format.componentOrder) && format.componentOrder.length === standard.length && new Set(format.componentOrder).size === standard.length && format.componentOrder.every((part: string) => standard.includes(part)) ? format.componentOrder : standard;
  const values: Record<string, string> = { prefix: format.prefix, branch: format.includeBranchCode ? branchCode : '', year: format.includeYear ? String(date.getFullYear()).slice(-2) : '', sequence: String(sequence).padStart(Number(format.digits), '0'), suffix: format.suffix };
  return order.map((part: string) => values[part]).filter(Boolean).join(String(format.separator ?? '-'));
};

export async function reservePartyCode(tx: Prisma.TransactionClient, accountId: string, orgId: string, kind: PartyKind, format: ReturnType<typeof codeFormatFor>, branchScope: string, branchCode: string, date = new Date()) {
  for (let attempt = 0; attempt < 10000; attempt += 1) {
    const counter = await tx.partyCodeCounter.upsert({
      where: { orgId_kind_branchScope: { orgId, kind, branchScope } },
      create: { accountId, orgId, kind, branchScope, nextNumber: BigInt(format.nextNumber) + 1n },
      update: { nextNumber: { increment: 1 } },
    });
    const sequence = counter.nextNumber - 1n;
    if (String(sequence).length > Number(format.digits)) throw new Error('The party code sequence has reached its configured digit limit');
    const code = renderPartyCode(format, sequence, branchCode, date);
    if ((code.match(/\d/g) || []).length > 10) throw new Error('No numbers remain in this code format');
    const used = await tx.party.findFirst({ where: { orgId, code }, select: { id: true } });
    if (!used) return code;
  }
  throw new Error('No unused party code could be allotted');
}

export async function backfillPartyCodes(tx: Prisma.TransactionClient, accountId: string, orgId: string, kind: PartyKind, profileJson: string | null) {
  const format = codeFormatFor(profileJson, kind);
  const parties = await tx.party.findMany({
    where: { accountId, orgId, partyType: { in: [kind, 'BOTH'] }, OR: [{ code: null }, { code: '' }] },
    select: { id: true, name: true, createdAt: true, branchId: true, codeBranchId: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  // Branches are kept in the platform database, so they are read outside this Books transaction.
  const branches = format.includeBranchCode
    ? await platformPrisma.branch.findMany({ where: { accountId, orgId }, select: { id: true, branchCode: true }, orderBy: { createdAt: 'asc' } })
    : [];
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));
  const headOffice = branches.find((branch) => branch.branchCode.toUpperCase() === 'HO') || branches[0];
  if (format.includeBranchCode && parties.length && !headOffice) throw new Error('Create a branch before enabling branch-based party codes');
  const assigned: Array<{ id: string; name: string; code: string; kind: PartyKind }> = [];
  for (const party of parties) {
    const branch = format.includeBranchCode ? branchById.get(party.codeBranchId || party.branchId || '') || headOffice : undefined;
    const code = await reservePartyCode(tx, accountId, orgId, kind, format, branch?.id || '', branch?.branchCode || '', party.createdAt);
    await tx.party.update({ where: { id: party.id }, data: { code, codeBranchId: branch?.id || null } });
    assigned.push({ id: party.id, name: party.name, code, kind });
  }
  return assigned;
}
