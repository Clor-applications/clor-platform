import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { policiesFor } from './policies.js';
import { todayIst } from '../../utils/istDate.js';

/**
 * Decision records (docs/people/02-PRD.md TRACE-05). When a request is
 * finally approved, what it rested on is frozen: the policy versions in force
 * for the person that day, the ones the request named, and each evidence
 * document with the version it had. The Why panel reads this record, so a
 * policy changed later never rewrites why an old decision was made.
 */

type Req = { id: string; accountId: string; orgId: string; subjectEmployeeId: string | null; ruleId: string; ruleVersion: number; payload: unknown };

export async function recordDecision(request: Req) {
  const payload = (request.payload || {}) as { evidence?: Array<{ documentId?: string; title?: string }>; policyVersionIds?: string[] };
  const inForce = request.subjectEmployeeId ? await policiesFor(request.orgId, request.subjectEmployeeId, todayIst()) : [];
  const named = (Array.isArray(payload.policyVersionIds) ? payload.policyVersionIds : []).map(String).filter((id) => !inForce.some((p) => p.versionId === id));
  const extra = named.length ? await peoplePrisma.policyVersion.findMany({ where: { orgId: request.orgId, id: { in: named } }, include: { policy: { select: { title: true, category: true } } } }) : [];
  const policyVersions = [
    ...inForce.map((p) => ({ policyId: p.policyId, versionId: p.versionId, title: p.title, category: p.category, version: p.version, effectiveFrom: p.effectiveFrom })),
    ...extra.map((v) => ({ policyId: v.policyId, versionId: v.id, title: v.policy.title, category: v.policy.category, version: v.version, effectiveFrom: v.effectiveFrom })),
  ];
  const docIds = (Array.isArray(payload.evidence) ? payload.evidence : []).map((d) => d?.documentId).filter((x): x is string => Boolean(x));
  const docs = docIds.length ? await peoplePrisma.employeeDocument.findMany({ where: { orgId: request.orgId, id: { in: docIds } }, select: { id: true, title: true, version: true } }) : [];
  const evidence = docIds.map((id) => { const d = docs.find((x) => x.id === id); return { documentId: id, title: d?.title || 'Removed document', version: d?.version ?? null }; });
  return peoplePrisma.decisionRecord.upsert({
    where: { requestId: request.id },
    create: { accountId: request.accountId, orgId: request.orgId, requestId: request.id, employeeId: request.subjectEmployeeId, ruleId: request.ruleId, ruleVersion: request.ruleVersion, policyVersions, evidence },
    update: {},
  });
}
