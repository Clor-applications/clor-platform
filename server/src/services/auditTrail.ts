import type { Request } from 'express';

import { platformPrisma } from '../utils/platformPrisma.js';
import { editLogChanges } from '../middleware/auditMutations.js';

/**
 * One line in the audit log (platform AuditLog, append-only: routes/audit.ts
 * only reads it). For the actions an auditor asks about afterwards — who
 * approved this pay run, who changed where somebody is paid, who closed the
 * month. Never fails the action it records: a log that could not be written
 * is reported, not allowed to undo the work.
 */
export async function recordAudit(
  req: Request,
  entry: { entity: string; entityId: string; action: string; message: string; metadata?: Record<string, unknown> }
) {
  try {
    /* The record's before and after values, where the edit log reads them (auditMutations.ts EDIT_LOG). */
    const changes = await editLogChanges(req);
    await platformPrisma.auditLog.create({
      data: {
        accountId: req.tenant!.accountId,
        orgId: req.tenant!.orgId,
        branchId: req.tenant!.branchId || '',
        entity: entry.entity,
        entityId: entry.entityId,
        action: entry.action,
        message: entry.message.slice(0, 500),
        metadata: entry.metadata ? JSON.stringify(entry.metadata).slice(0, 20_000) : null,
        createdByUserId: req.auth!.userId,
        correlationId: typeof (req as any).id === 'string' ? String((req as any).id).slice(0, 80) : null,
        ...(changes ? { changes } : {}),
      },
    });
    /* Logged here with the detail; the generic change log (middleware/auditMutations.ts) skips this request. Only once
       written: a line that failed leaves the generic log to record the request instead of nothing. */
    if (req.res) req.res.locals.audited = true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[audit] ${entry.entity} ${entry.action} not recorded:`, e instanceof Error ? e.message : e);
  }
}
