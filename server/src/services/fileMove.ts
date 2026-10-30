import { peoplePrisma } from '../utils/peoplePrisma.js';
import { outsideTenant, runInTenant } from '../utils/tenantScope.js';
import { fileStore } from './fileStore.js';

/**
 * R2 plan, S6: move files already in the database to the store, one row at a
 * time. Writing a row's bytes back through the people client is what moves
 * them (utils/fileOffload.ts puts the object, then the row keeps the key and
 * empty bytes), so a run that stops part-way leaves every row either moved or
 * untouched, and the next run carries on. Safe to run again.
 */
export async function moveFilesToStore(opts: { batch?: number; only?: string[] } = {}) {
  if (!fileStore()) return { moved: 0, skipped: 'FILE_STORE is not set: files stay in the database.' };
  const take = opts.batch ?? 200;
  const scope = opts.only ? { orgId: { in: opts.only } } : {};
  let moved = 0;
  const models = [
    { name: 'employeeDocument', where: { ...scope, storageKey: null }, field: 'data' },
    { name: 'punchPhoto', where: { ...scope, storageKey: null }, field: 'data' },
    { name: 'complianceTask', where: { ...scope, evidenceKey: null, evidenceData: { not: null } }, field: 'evidenceData' },
    { name: 'obligationProof', where: { ...scope, storageKey: null }, field: 'data' },
  ] as const;
  for (const m of models) {
    const delegate = (peoplePrisma as any)[m.name];
    let cursor: string | undefined;
    for (;;) {
      const rows: Array<{ id: string; orgId: string }> = await outsideTenant('files: which rows still hold their bytes', () =>
        delegate.findMany({ where: m.where, select: { id: true, orgId: true }, orderBy: { id: 'asc' }, take, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) })
      );
      if (!rows.length) break;
      for (const r of rows) {
        await runInTenant(r.orgId, async () => {
          const full = await delegate.findUnique({ where: { id: r.id }, select: { [m.field]: true } });
          const bytes = full?.[m.field];
          if (bytes && bytes.length) {
            await delegate.update({ where: { id: r.id }, data: { [m.field]: Buffer.from(bytes) } });
            moved += 1;
          }
        });
      }
      cursor = rows[rows.length - 1].id;
    }
  }
  return { moved };
}

/**
 * The way back (rollback): copy every stored file into its row again and
 * clear the key, so FILE_STORE can be switched off or old code run. Objects
 * are left in the bucket; the nightly check removes them once no row names
 * them. Raw SQL, so the people client does not send the bytes straight back.
 */
export async function moveFilesToDatabase(opts: { only?: string[] } = {}) {
  const store = fileStore();
  if (!store) return { restored: 0, skipped: 'FILE_STORE is not set: there is no store to read from.' };
  const tables = [
    { table: 'EmployeeDocument', bytes: 'data', key: 'storageKey' },
    { table: 'PunchPhoto', bytes: 'data', key: 'storageKey' },
    { table: 'ComplianceTask', bytes: 'evidenceData', key: 'evidenceKey' },
    { table: 'ObligationProof', bytes: 'data', key: 'storageKey' },
  ];
  let restored = 0;
  for (const t of tables) {
    const rows: Array<{ id: string; orgId: string; key: string }> = await outsideTenant('files: which rows point at the store', () =>
      peoplePrisma.$queryRawUnsafe(`SELECT id, "orgId", "${t.key}" AS key FROM "${t.table}" WHERE "${t.key}" IS NOT NULL${opts.only ? ` AND "orgId" = ANY($1::text[])` : ''}`, ...(opts.only ? [opts.only] : []))
    );
    for (const r of rows) {
      const bytes = await store.get(r.orgId, r.key);
      if (!bytes) continue; /* reported by the nightly check; leave the key so nothing pretends the file is empty */
      await runInTenant(r.orgId, () => peoplePrisma.$executeRawUnsafe(`UPDATE "${t.table}" SET "${t.bytes}" = $1, "${t.key}" = NULL WHERE id = $2`, bytes, r.id));
      restored += 1;
    }
  }
  return { restored };
}
