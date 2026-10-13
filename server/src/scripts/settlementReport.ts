/**
 * Read-only: which documents' stored settlement disagrees with their
 * allocations, and by how much.
 *
 * Nothing is written. This is the report that decides whether a backfill is
 * warranted — it is deliberately not the backfill, because rewriting historical
 * accounting rows is a decision somebody has to take with the numbers in front
 * of them.
 *
 *   npm run report:settlement
 */
import { prisma } from '../utils/prisma.js';
import { settlementDiscrepancies } from '../services/settlement.js';

const money = (n: number) => n.toFixed(2).padStart(14);

async function main() {
  const orgId = process.argv[2] || undefined;
  const report = await settlementDiscrepancies(orgId ? { orgId } : {});

  console.log('');
  console.log('Settlement reconciliation — stored vs allocations');
  console.log(`  invoices checked : ${report.invoicesChecked}`);
  console.log(`  bills checked    : ${report.billsChecked}`);
  console.log(`  disagreeing      : ${report.disagreeing}`);
  console.log('');

  if (!report.rows.length) {
    console.log('  Every document agrees with its allocations.');
  } else {
    console.log(
      ['  TYPE    ', 'NUMBER'.padEnd(18), 'TOTAL'.padStart(14), 'STORED'.padStart(14), 'VALID ALLOC'.padStart(14), 'DIFF'.padStart(14), '  STATUS'].join('')
    );
    for (const r of report.rows) {
      console.log(
        [
          `  ${r.docType.padEnd(8)}`,
          String(r.number || r.id).padEnd(18),
          money(r.total),
          money(r.storedPaidAmount),
          money(r.validAllocated),
          money(r.paidDifference),
          r.statusDiffers ? `  ${r.storedStatus} -> ${r.expectedStatus}` : `  ${r.storedStatus}`,
        ].join('')
      );
    }
    const net = report.rows.reduce((s, r) => s + r.paidDifference, 0);
    console.log('');
    console.log(`  net settlement difference: ${net.toFixed(2)}`);
  }
  console.log('');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
