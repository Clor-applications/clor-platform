/**
 * GAP-010: list (and with --repair, fix what is safe to fix) names one
 * database keeps of another's records that point at nothing.
 *
 *   npm run integrity:cross-store                 every company, report only
 *   npm run integrity:cross-store -- --org <id>   one company
 *   npm run integrity:cross-store -- --repair     also repair access rows and orphaned credentials
 *
 * Reads the four DATABASE_URLs from the environment like the API, as the
 * owner role (a runtime role sees only the company it is told about). Payroll
 * history is only ever reported. The nightly job does the same with --repair.
 */
import { outsideTenant } from '../utils/tenantScope.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { checkAllCompanies, checkCompany } from '../services/integrity/checks.js';

const args = process.argv.slice(2);
const repair = args.includes('--repair');
const org = args.includes('--org') ? args[args.indexOf('--org') + 1] : null;

if (org) {
  const o = await outsideTenant('integrity: one company', () => platformPrisma.org.findUnique({ where: { id: org }, select: { id: true, accountId: true } }));
  if (!o) {
    console.error(`No company ${org}.`);
    process.exit(1);
  }
  const found = await checkCompany({ accountId: o.accountId, orgId: o.id }, { repair });
  for (const f of found) console.log(`${f.repair}\t${f.link}\t${f.sourceId}\t→ ${f.target}`);
  console.log(`${found.length} found, ${found.filter((f) => f.repair === 'REPAIRED').length} repaired.`);
} else {
  console.log(JSON.stringify(await checkAllCompanies({ repair }), null, 2));
}
process.exit(0);
