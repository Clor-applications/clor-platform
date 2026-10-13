/**
 * Bring stored settlement back in line with the allocations that justify it.
 *
 * Documents settled before `0dbd0f3` carry `paidAmount` / `settledAmount` of
 * zero even though receipts were recorded against them: the payment routes
 * stored the allocation and the ledger, and never wrote the document. The
 * ledger has been right the whole time. This rewrites only the projection.
 *
 * It computes nothing of its own. The numbers come from the same service the
 * application uses — `recalcDocumentSettlement`, deriving from valid
 * allocations — so a document reconciled here holds exactly what it would hold
 * had the receipt been taken today. That is also what makes it idempotent: it
 * assigns a derived value, it never adds to one, so a second run finds nothing
 * to do.
 *
 * ---------------------------------------------------------------------------
 * Targeting is explicit, always.
 *
 * `/opt/clor/server/.env` on the production host still says
 * `DATABASE_URL="file:./dev.db"`. The API never reads it — systemd supplies
 * the real value through `EnvironmentFile=/opt/clor/.env`, and `dotenv` does
 * not overwrite what is already set. A maintenance command run by hand in that
 * directory has no such protection: Prisma finds the stale file and silently
 * works on a database that is not the books. It is the kind of mistake that
 * looks like success.
 *
 * So this script refuses to guess. The target is named on the command line, it
 * must be an absolute file: URL, the file must already exist, and what was
 * found there is printed before anything is considered.
 * ---------------------------------------------------------------------------
 *
 *   # look only
 *   npx tsx src/scripts/reconcileSettlement.ts --database-url=file:/opt/clor/data/prod.db
 *
 *   # write, having read the dry run and agreed with its row count
 *   npx tsx src/scripts/reconcileSettlement.ts \
 *       --database-url=file:/opt/clor/data/prod.db --apply --expect-rows=2
 */
import { statSync } from 'node:fs';

type Row = {
  docType: 'INVOICE' | 'BILL';
  id: string;
  number: string;
  total: number;
  storedPaidAmount: number;
  validAllocated: number;
  expectedPaidAmount: number;
  storedStatus: string;
  expectedStatus: string;
  paidDifference: number;
  statusDiffers: boolean;
};

const arg = (name: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const money = (n: number) => n.toFixed(2);

function fail(message: string): never {
  console.error(`\n  REFUSED: ${message}\n`);
  process.exit(2);
}

async function main() {
  // -------------------------------------------------------------------------
  // 1. The target, named explicitly and proved before anything else happens.
  // -------------------------------------------------------------------------
  const url = arg('database-url') || process.env.RECONCILE_DATABASE_URL || '';
  if (!url) fail('name the database: --database-url=file:/opt/clor/data/prod.db');
  if (!url.startsWith('file:/') || url.startsWith('file:./') || url.startsWith('file:../')) {
    fail(`the database must be an absolute file: URL, not "${url}"`);
  }

  const path = url.replace(/^file:/, '').split('?')[0];
  let size = 0;
  try {
    const st = statSync(path);
    if (!st.isFile()) fail(`${path} is not a file`);
    size = st.size;
  } catch {
    fail(`${path} does not exist — this script never creates a database`);
  }
  if (size === 0) fail(`${path} is empty — that is not a set of books`);

  /* Set before Prisma is imported: the client reads DATABASE_URL when it is
     constructed, and a static import would run first. */
  process.env.DATABASE_URL = url;

  const { prisma } = await import('../utils/prisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
  const { settlementDiscrepancies, recalcDocumentSettlement } = await import('../services/settlement.js');

  const apply = flag('apply');
  const expectRows = arg('expect-rows');

  // -------------------------------------------------------------------------
  // 2. Prove what was opened.
  // -------------------------------------------------------------------------
  const counts = {
    invoices: await prisma.invoice.count(),
    bills: await prisma.bill.count(),
    payments: await prisma.payment.count(),
    allocations: await prisma.paymentAllocation.count(),
    journalEntries: await prisma.journalEntry.count(),
    journalLines: await prisma.journalLine.count(),
  };
  const orgs = await platformPrisma.org.findMany({ select: { id: true, name: true }, take: 5 });

  console.log('');
  console.log('Settlement reconciliation');
  console.log(`  mode            : ${apply ? 'APPLY — this will write' : 'DRY RUN — nothing is written'}`);
  console.log(`  database        : ${path}`);
  console.log(`  size            : ${size.toLocaleString()} bytes`);
  console.log(`  invoices        : ${counts.invoices}`);
  console.log(`  bills           : ${counts.bills}`);
  console.log(`  payments        : ${counts.payments}`);
  console.log(`  allocations     : ${counts.allocations}`);
  console.log(`  journal entries : ${counts.journalEntries} (${counts.journalLines} lines)`);
  console.log(`  organisations   : ${orgs.map((o) => `${o.name}`).join(', ') || '(none)'}`);
  console.log('');

  // -------------------------------------------------------------------------
  // 3. What disagrees, from the canonical service.
  // -------------------------------------------------------------------------
  const report = await settlementDiscrepancies();
  const rows = report.rows as Row[];
  /* A status-only difference is a projection too, but it moves no money; the
     two are reported apart so the monetary figure means one thing. */
  const monetary = rows.filter((r) => r.paidDifference !== 0);
  const statusOnly = rows.filter((r) => r.paidDifference === 0);
  const net = rows.reduce((s, r) => s + r.paidDifference, 0);

  console.log(`  checked         : ${report.invoicesChecked} invoices, ${report.billsChecked} bills`);
  console.log(`  disagreeing     : ${rows.length}  (${monetary.length} monetary, ${statusOnly.length} status only)`);
  console.log(`  net monetary    : ${money(net)}`);
  console.log('');

  if (!rows.length) {
    console.log('  Nothing to reconcile — every document already matches its allocations.');
    console.log('');
    await prisma.$disconnect();
    return;
  }

  for (const r of rows) {
    const field = r.docType === 'INVOICE' ? 'paidAmount' : 'settledAmount';
    console.log(`  ${r.docType} ${r.number}   total ${money(r.total)}`);
    console.log(`    ${field.padEnd(14)}: ${money(r.storedPaidAmount)} -> ${money(r.expectedPaidAmount)}   (allocations ${money(r.validAllocated)})`);
    console.log(`    ${'status'.padEnd(14)}: ${r.storedStatus} -> ${r.expectedStatus}${r.statusDiffers ? '' : '   (unchanged)'}`);
    console.log('');
  }

  if (!apply) {
    console.log(`  Dry run complete. ${rows.length} row(s) would change; no journal entry, allocation or payment is touched.`);
    console.log(`  To write: --apply --expect-rows=${rows.length}`);
    console.log('');
    await prisma.$disconnect();
    return;
  }

  // -------------------------------------------------------------------------
  // 4. Writing requires agreeing, in advance, with what the dry run found.
  // -------------------------------------------------------------------------
  if (!expectRows) fail('--apply also needs --expect-rows=N, matching the dry run');
  if (Number(expectRows) !== rows.length) {
    fail(`--expect-rows=${expectRows} but ${rows.length} row(s) now disagree — re-read the dry run`);
  }

  let changed = 0;
  for (const r of rows) {
    const doc =
      r.docType === 'INVOICE'
        ? await prisma.invoice.findUnique({ where: { id: r.id }, select: { accountId: true, orgId: true } })
        : await prisma.bill.findUnique({ where: { id: r.id }, select: { accountId: true, orgId: true } });
    if (!doc) continue;
    const result = await recalcDocumentSettlement(prisma, {
      accountId: doc.accountId,
      orgId: doc.orgId,
      docType: r.docType,
      docId: r.id,
    });
    if (result?.changed) changed += 1;
  }

  // -------------------------------------------------------------------------
  // 5. Prove nothing else moved, and that a second run would find nothing.
  // -------------------------------------------------------------------------
  const after = {
    payments: await prisma.payment.count(),
    allocations: await prisma.paymentAllocation.count(),
    journalEntries: await prisma.journalEntry.count(),
    journalLines: await prisma.journalLine.count(),
  };
  const recheck = await settlementDiscrepancies();

  console.log(`  rows changed          : ${changed}`);
  console.log(`  payments delta        : ${after.payments - counts.payments}`);
  console.log(`  allocations delta     : ${after.allocations - counts.allocations}`);
  console.log(`  journal entries delta : ${after.journalEntries - counts.journalEntries}`);
  console.log(`  journal lines delta   : ${after.journalLines - counts.journalLines}`);
  console.log(`  remaining discrepancies: ${recheck.disagreeing}`);
  console.log('');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
